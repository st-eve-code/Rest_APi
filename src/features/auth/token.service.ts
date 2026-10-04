/**
 * =============================================================================
 * WHAT A JWT ACTUALLY IS
 * =============================================================================
 *
 * Three base64url strings, separated by dots:
 *
 *   header.payload.signature
 *
 *   header    {"alg":"HS256","typ":"JWT"}      -- readable by anyone
 *   payload   {"sub":"...","role":"user",...} -- readable by anyone
 *   signature HMAC-SHA256(header + "." + payload, secret)
 *
 * "Readable by anyone" is the point people trip over: a JWT is NOT encrypted. It
 * is SIGNED, which means an attacker can read your claims but cannot ALTER them
 * without invalidating the signature. So two rules follow:
 *
 *   1. Never put anything secret in the payload (no passwords, no card numbers).
 *   2. Never trust the payload until you have verified the signature yourself.
 *      Decoding is not verifying -- `jwt.decode` does no cryptography at all.
 *
 * `jwt.verify()` is what checks the signature AND the expiry. It is the only
 * function in this file that should ever touch a token from a client.
 *
 * =============================================================================
 */
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../../config';
import { ApiError } from '../../lib/ApiError';
import type { UserRole } from '../../types/user';

/**
 * The claims we put in an access token. Deliberately tiny.
 *
 * Every extra claim is data an attacker gets for free, and data that can go
 * stale -- a token saying `role: "admin"` stays true for its whole life even
 * after the role is downgraded. Keep the payload to identity plus the one fact
 * needed for authorisation, and re-read anything else from the database.
 */
export interface AccessTokenClaims {
  /** Subject = the user id. `sub` is the registered claim name for this. */
  sub: string;
  email: string;
  role: UserRole;
}

/** Marks a token as an access token, so it can never be used as a refresh token. */
export interface RefreshTokenClaims {
  sub: string;
  /** Unique id of the session row; lets one device be revoked on its own. */
  jti: string;
}

/** Everything the client needs after a successful login or refresh. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds until `accessToken` expires, for the client to schedule a refresh. */
  expiresIn: number;
  tokenType: 'Bearer';
}

const BEARER_PREFIX = /^Bearer\s+/i;

/**
 * Signs a short-lived access token.
 *
 * `expiresIn` comes from config, so the TTL lives in one place instead of being
 * retyped at every call site (where one forgotten value would create a token
 * that never expires).
 */
export function signAccessToken(claims: AccessTokenClaims): { token: string; expiresIn: number } {
  const expiresIn = secondsUntilExpiry(config.jwt.accessTtl);

  // No `algorithm` option here on purpose: jsonwebtoken picks the algorithm from
  // the key type, and a string secret means HS256. The `algorithms: ['HS256']`
  // allow-list on the VERIFY side is what actually matters -- that is the option
  // that stops `alg: none` and HS/RS confusion attacks.
  //
  // `expiresIn` is passed as a NUMBER of seconds, not the "15m" string from
  // .env, so the token TTL and the refresh cookie TTL are computed by the same
  // function and cannot drift apart.
  const token = jwt.sign(claims, config.jwt.secret, {
    expiresIn,
    issuer: config.jwt.issuer,
  });

  return { token, expiresIn };
}

/** Issues a refresh token plus the id of the session it belongs to. */
export function signRefreshToken(userId: string, sessionId: string): string {
  return jwt.sign({ sub: userId, jti: sessionId } satisfies RefreshTokenClaims, config.jwt.refreshSecret, {
    expiresIn: secondsUntilExpiry(config.jwt.refreshTtl),
    issuer: config.jwt.issuer,
  });
}

/**
 * Verifies an access token and returns its claims.
 *
 * Throws `ApiError.unauthorized` for every failure -- expired, tampered, signed
 * with the wrong secret, wrong issuer, malformed. We deliberately do NOT say
 * which: telling an attacker "this token expired, try again" versus "this
 * signature is invalid" hands them a free oracle for probing the system.
 */
export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    // `algorithms: ['HS256']` is not optional. Without it, a token whose header
    // says `alg: none` is accepted by some libraries -- the classic JWT bypass.
    const payload = jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256'],
      issuer: config.jwt.issuer,
    });

    if (typeof payload === 'string' || !isAccessTokenClaims(payload)) {
      throw new Error('Unexpected token payload');
    }

    return payload;
  } catch {
    throw ApiError.unauthorized('Invalid or expired access token');
  }
}

/** Same guarantees as `verifyAccessToken`, but signs in with the refresh secret. */
export function verifyRefreshToken(token: string): RefreshTokenClaims {
  try {
    const payload = jwt.verify(token, config.jwt.refreshSecret, {
      algorithms: ['HS256'],
      issuer: config.jwt.issuer,
    });

    if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
      throw new Error('Unexpected token payload');
    }

    return { sub: payload.sub, jti: payload.jti };
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }
}

/**
 * Pulls the bearer token out of the `Authorization` header.
 *
 * Returns `null` rather than throwing for anything unusable, so `authenticate`
 * can answer "no usable token here" with a single 401 instead of a mix of
 * thrown errors and null checks.
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;

  const match = BEARER_PREFIX.exec(header.trim());
  if (!match) return null;

  const token = header.trim().slice(match[0].length).trim();
  return token.length > 0 ? token : null;
}

/**
 * SHA-256 of a refresh token, as hex.
 *
 * We store this instead of the token so a database dump cannot be replayed as
 * real sessions. SHA-256 (not bcrypt) is the right tool here: we need a fast,
 * deterministic lookup keyed by the token, and the input is already 256 bits of
 * signed randomness, so there is nothing to brute-force.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** A fresh random id for a refresh session. */
export function createSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Turns "15m" / "7d" / "900" into seconds, without pulling in a date library.
 *
 * Only the units JWT itself accepts are handled; anything else throws at startup
 * rather than silently meaning "no expiry".
 */
export function secondsUntilExpiry(ttl: string): number {
  const match = /^(\d+)([smhd])?$/.exec(ttl.trim());

  if (!match) {
    throw new Error(`Unsupported TTL "${ttl}". Use forms like 900, 15m, 12h or 7d.`);
  }

  const value = Number(match[1]);
  const unit = match[2] ?? 's';

  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };
  return value * multipliers[unit];
}

/** Absolute expiry date for a refresh session, used for the DB row. */
export function refreshExpiryDate(): Date {
  return new Date(Date.now() + secondsUntilExpiry(config.jwt.refreshTtl) * 1000);
}

/** Runtime guard: a verified payload is untrusted input like any other. */
function isAccessTokenClaims(payload: object): payload is AccessTokenClaims & jwt.JwtPayload {
  const candidate = payload as Record<string, unknown>;

  return (
    typeof candidate.sub === 'string' &&
    typeof candidate.email === 'string' &&
    typeof candidate.role === 'string'
  );
}