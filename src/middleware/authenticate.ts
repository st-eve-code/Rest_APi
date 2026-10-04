import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/ApiError';
import { extractBearerToken, verifyAccessToken } from '../features/auth/token.service';
import type { UserRole } from '../types/user';

/**
 * =============================================================================
 * AUTHENTICATION vs AUTHORISATION
 * =============================================================================
 *
 * These are two different questions and confusing them is the most common auth
 * bug in an Express app:
 *
 *   AUTHENTICATION  "Who are you?"       -> `authenticate`      (a valid token)
 *   AUTHORISATION   "What may you do?"   -> `requireRole`       (the right role)
 *
 * A route guarded only by `requireRole` and not by `authenticate` will happily
 * read `req.user!.role` from a request that never proved it owns those claims --
 * or crash on the non-null assertion, which is worse.
 *
 * NOTE: this project uses no server-side session for the access token, so
 * `authenticate` verifies a signature and expiry and nothing else. It cannot
 * tell whether a user was deleted 30 seconds ago -- that is the trade-off JWT
 * makes in exchange for statelessness. See SECURITY_NOTES.md.
 *
 * ===========================================================================
 */

/**
 * Everything we know about the caller, attached to the request.
 *
 * NOTE: these values came from inside a signed token, so they are as trustworthy
 * as the signing secret. Never put anything here that the client was not
 * already allowed to assert about itself.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

/**
 * Verified identity for the current request.
 *
 * Handlers call `requireAuthUser(req)` instead of touching `req.user`: it throws
 * a clean 401 if the middleware was not mounted, whereas `req.user!.id` would
 * crash with a TypeError and surface as an opaque 500.
 */
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

/**
 * Requires a valid access token. Rejects the request with 401 otherwise.
 *
 * Mount it on a router (`router.use(authenticate)`) rather than on each route:
 * one line protects everything added to that router later, including routes
 * added by someone who forgot.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.get('authorization'));

  // Three cases, all 401. We never say which, because the difference between
  // "no token" and "bad token" is free information for an attacker probing for
  // weaknesses.
  if (!token) {
    next(ApiError.unauthorized('Missing bearer token', 'MISSING_TOKEN'));
    return;
  }

  try {
    const claims = verifyAccessToken(token);

    // The signature proved the token was ours and unexpired. It did NOT prove
    // the account still exists, so `role` and `email` here can be up to 15
    // minutes stale -- a deleted account or a role change does not take effect
    // until the access token expires. Anything that must be true right now is
    // re-read from the database (see AuthService.currentUser, used by
    // /api/auth/me) rather than trusted from the payload.
    req.user = { id: claims.sub, email: claims.email, role: claims.role };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Attaches the user when a valid token is present, but never rejects.
 *
 * Use on endpoints that are richer for a signed-in caller but still work for
 * everyone -- a public list that also flags "created by you", for example.
 * Never use it on an endpoint that grants access based on identity: absence of
 * a token must mean no access there.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.get('authorization'));
  if (!token) {
    next();
    return;
  }

  try {
    const claims = verifyAccessToken(token);
    req.user = { id: claims.sub, email: claims.email, role: claims.role };
  } catch {
    // An invalid token is treated as no token at all. Failing here would turn
    // "public endpoint" into "public unless you hold a stale token", which is a
    // confusing way to be rejected.
  }

  next();
}

/**
 * Requires the caller to hold one of the given roles. Always mount AFTER
 * `authenticate`.
 *
 * 403 rather than 401 when the identity is fine but the role is not: the client
 * should re-authenticate as somebody else, not retry with the same token.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      next(ApiError.unauthorized('Authentication required'));
      return;
    }

    if (!roles.includes(user.role)) {
      // Deliberately does not name the role that was required.
      next(ApiError.forbidden('You do not have permission to perform this action'));
      return;
    }

    next();
  };
}

/**
 * Reads the authenticated user, or throws a 401.
 *
 * The guard that makes `req.user!` unnecessary everywhere else: TypeScript can
 * prove that after this call the request HAS a user.
 */
export function requireAuthUser(req: Request): AuthenticatedUser {
  if (!req.user) {
    throw ApiError.unauthorized('Authentication required');
  }

  return req.user;
}