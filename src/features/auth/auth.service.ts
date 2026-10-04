import { ApiError } from '../../lib/ApiError';
import { toPublicUser, type PublicUser, type User } from '../../types/user';
import { isWeakPassword, hashPassword, verifyPassword } from './password';
import {
  createSessionId,
  hashToken,
  refreshExpiryDate,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type TokenPair,
} from './token.service';
import type { LoginBody, RegisterBody } from './auth.validator';
import type { UserRepository } from './userRepository';

/**
 * =============================================================================
 * THE AUTH SERVICE
 * =============================================================================
 *
 * All of the security decisions live here, and none of them live in the
 * controller: the controller only translates HTTP, this layer knows nothing
 * about requests or responses.
 *
 * The rules it enforces:
 *
 *   1. Passwords are hashed with bcrypt before they touch the repository.
 *   2. Login failures are indistinguishable from each other (same 401, same
 *      message, same ~time), so the endpoint cannot be used to discover which
 *      emails have accounts.
 *   3. Refresh tokens are single-use and rotated on every refresh.
 *   4. Reusing an already-used refresh token means it was stolen: every session
 *      for that user is revoked.
 *   5. A disabled account cannot get new tokens, and an existing token stops
 *      working at the next request.
 *
 * ===========================================================================
 */

/** Where a request came from, recorded against each refresh session. */
export interface SessionContext {
  userAgent: string | null;
  ipAddress: string | null;
}

/** What login and register both return. */
export interface AuthResult {
  user: PublicUser;
  tokens: TokenPair;
}

/**
 * ONE message for every way a login can fail.
 *
 * "Account not found" and "wrong password" must be indistinguishable, otherwise
 * the endpoint becomes an email-enumeration oracle: an attacker can script
 * through a list of addresses and learn who has an account here. The cost is
 * that a real user with a typo gets a vaguer message, which is the right
 * trade-off.
 */
const INVALID_CREDENTIALS = 'Invalid email or password';

/** Postgres unique-violation: someone registered that email a moment ago. */
const PG_UNIQUE_VIOLATION = '23505';

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly logger: Pick<Console, 'info' | 'warn' | 'error'> = console,
  ) {}

  /**
   * POST /api/auth/register
   *
   * The only endpoint that creates users, and it is open -- so it is also the
   * one place an attacker can try to make us store a million accounts. See the
   * rate-limiting note in SECURITY_NOTES.md.
   */
  async register(body: RegisterBody, context: SessionContext): Promise<AuthResult> {
    if (await this.users.findByEmail(body.email)) {
      throw ApiError.conflict('An account with that email already exists', [
        { field: 'email', message: 'Email is already registered' },
      ]);
    }

    if (isWeakPassword(body.password)) {
      throw ApiError.badRequest('Validation failed', [
        {
          field: 'password',
          message: 'Use at least 12 characters and mix letters, numbers and symbols',
        },
      ]);
    }

    // Hash BEFORE the repository sees anything. The plaintext exists only in
    // this function's scope, and is never logged or returned.
    const passwordHash = await hashPassword(body.password);

    let user: User;
    try {
      user = await this.users.create({ email: body.email, passwordHash });
    } catch (error) {
      // Two concurrent registrations of the same email: the pre-check above
      // cannot see the other one, but the unique index can. Turn the database's
      // integrity error into the same 409 the pre-check would have produced.
      if (isUniqueViolation(error)) {
        throw ApiError.conflict('An account with that email already exists', [
          { field: 'email', message: 'Email is already registered' },
        ]);
      }
      throw error;
    }

    this.logger.info(`[auth] registered ${user.email} (${user.id})`);

    return { user: toPublicUser(user), tokens: await this.issueTokens(user, context) };
  }

  /**
   * POST /api/auth/login
   *
   * Note the deliberate `await verifyPassword(...)` even when no user was found:
   * without it, a missing account returns instantly while a real one takes
   * ~100ms of bcrypt, and that timing gap is enough to enumerate accounts.
   * Comparing against a fixed dummy hash keeps both paths equally slow.
   */
  async login(body: LoginBody, context: SessionContext): Promise<AuthResult> {
    const user = await this.users.findByEmail(body.email);

    const passwordMatches = await verifyPassword(
      body.password,
      user?.passwordHash ?? DUMMY_HASH,
    );

    if (!user || !passwordMatches) {
      this.logger.warn(`[auth] failed login for ${body.email}`);
      throw ApiError.unauthorized(INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
    }

    if (user.disabledAt) {
      // Deliberately the same shape as a bad password: a user who was disabled
      // should not be able to confirm the account still exists.
      this.logger.warn(`[auth] login attempt on disabled account ${user.email}`);
      throw ApiError.unauthorized(INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
    }

    this.logger.info(`[auth] logged in ${user.email} (${user.id})`);

    return { user: toPublicUser(user), tokens: await this.issueTokens(user, context) };
  }

  /**
   * POST /api/auth/refresh
   *
   * Exchanges a refresh token for a new pair. The old one is burned, which is
   * what makes theft detectable: if a thief uses a token after the real client
   * has already rotated it, the second attempt fails -- and we respond by
   * revoking EVERY session for that user, on the assumption that one of the two
   * parties is an attacker and we cannot yet tell which.
   */
  async refresh(refreshToken: string, context: SessionContext): Promise<AuthResult> {
    const claims = verifyRefreshToken(refreshToken);
    const tokenHash = hashToken(refreshToken);

    // Atomic consume. False means the session was already used, revoked, or has
    // expired -- all three are "this token is not valid", and we do not say which.
    const consumed = await this.users.consumeRefreshSession(claims.jti, new Date());

    if (!consumed) {
      this.logger.warn(`[auth] refresh token replay detected for user ${claims.sub}`);
      await this.revokeEverything(claims.sub);
      throw ApiError.unauthorized('Refresh token is no longer valid', 'TOKEN_REUSE');
    }

    const user = await this.users.findById(claims.sub);

    if (!user || user.disabledAt) {
      // The account was deleted or disabled after the token was issued. Trusting
      // the token here would be exactly the mistake that makes JWT auth scary:
      // the token's claim about the user is now stale.
      await this.revokeEverything(claims.sub);
      throw ApiError.unauthorized('Account is no longer active', 'ACCOUNT_INACTIVE');
    }

    this.logger.info(`[auth] refreshed session for ${user.email}`);

    return { user: toPublicUser(user), tokens: await this.issueTokens(user, context) };
  }

  /**
   * POST /api/auth/logout
   *
   * Idempotent on purpose: logging out twice, or logging out with an
   * already-dead token, must both succeed. A logout that can fail is a logout
   * users will retry with a stale token and report as a bug.
   */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;

    try {
      const claims = verifyRefreshToken(refreshToken);
      await this.users.consumeRefreshSession(claims.jti, new Date());
      this.logger.info(`[auth] logged out session ${claims.jti}`);
    } catch {
      // Already expired or already revoked. Nothing left to do.
    }
  }

  /** POST /api/auth/logout-all -- kill every session for the signed-in user. */
  async logoutEverywhere(userId: string): Promise<number> {
    const revoked = await this.users.revokeAllRefreshSessions(userId, new Date());
    this.logger.info(`[auth] revoked ${revoked} session(s) for user ${userId}`);
    return revoked;
  }

  /** GET /api/auth/me -- re-reads the user, so a disabled account cannot linger. */
  async currentUser(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);

    if (!user || user.disabledAt) {
      throw ApiError.unauthorized('Account is no longer active', 'ACCOUNT_INACTIVE');
    }

    return toPublicUser(user);
  }

  /**
   * Mints an access + refresh pair and records the refresh session.
   *
   * The refresh token is signed with the session id inside it (`jti`), so the
   * token and its database row are bound together: a token with no matching live
   * row is rejected, and revoking the row kills the token immediately instead of
   * waiting for its expiry.
   */
  private async issueTokens(user: User, context: SessionContext): Promise<TokenPair> {
    const sessionId = createSessionId();
    const refreshToken = signRefreshToken(user.id, sessionId);

    await this.users.createRefreshSession({
      // The session id becomes the token's `jti`, so the row and the token are
      // bound together: a token with no matching live row is rejected, and
      // revoking the row kills the token immediately instead of waiting for it
      // to expire.
      id: sessionId,
      userId: user.id,
      // Store the hash, never the token: a database dump must not be replayable.
      tokenHash: hashToken(refreshToken),
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
      expiresAt: refreshExpiryDate().toISOString(),
    });

    const { token: accessToken, expiresIn } = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return { accessToken, refreshToken, expiresIn, tokenType: 'Bearer' };
  }

  private async revokeEverything(userId: string): Promise<void> {
    await this.users.revokeAllRefreshSessions(userId, new Date());
  }
}

/**
 * A valid bcrypt hash of a value nobody can guess, used only to burn the same
 * CPU time when the account does not exist. Generate with:
 *   node -e "console.log(require('bcryptjs').hashSync('unused', 10))"
 */
const DUMMY_HASH = '$2b$10$Ux6Vq3Lk3Dq3blRfLPj1Ku9hYRZ9xYQ3pQz0mXqRf9wXnM3lBq1eK';

/** Detects the Postgres unique-violation without importing the `pg` error class. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}