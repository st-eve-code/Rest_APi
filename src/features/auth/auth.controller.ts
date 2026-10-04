import type { CookieOptions, Request, Response } from 'express';
import { config } from '../../config';
import { sendSuccess } from '../../lib/ApiResponse';
import { ApiError } from '../../lib/ApiError';
import { requireAuthUser } from '../../middleware/authenticate';
import { secondsUntilExpiry } from './token.service';
import { loginSchema, refreshSchema, registerSchema, validateAuth } from './auth.validator';
import type { AuthService, SessionContext } from './auth.service';

/**
 * The controller's only job is translation, exactly like items.controller.ts:
 *
 *   HTTP request  ->  plain objects  ->  HTTP response
 *
 * Every security decision (hashing, rotation, generic error messages) lives in
 * AuthService. What IS here, and must be here, is the cookie handling -- that is
 * an HTTP concern, and the service has no business knowing what a Set-Cookie
 * header looks like.
 */
export function createAuthController(service: AuthService) {
  return {
    /** POST /api/auth/register */
    async register(req: Request, res: Response): Promise<void> {
      const body = validateAuth(registerSchema, req.body);
      const result = await service.register(body, sessionContext(req));

      setRefreshCookie(res, result.tokens.refreshToken);
      sendSuccess(res, 201, { user: result.user, ...result.tokens });
    },

    /** POST /api/auth/login */
    async login(req: Request, res: Response): Promise<void> {
      const body = validateAuth(loginSchema, req.body);
      const result = await service.login(body, sessionContext(req));

      setRefreshCookie(res, result.tokens.refreshToken);
      sendSuccess(res, 200, { user: result.user, ...result.tokens });
    },

    /** POST /api/auth/refresh */
    async refresh(req: Request, res: Response): Promise<void> {
      const body = validateAuth(refreshSchema, req.body ?? {});

      // Body first (native apps and Postman), cookie second (browsers).
      const token = body.refreshToken ?? readRefreshCookie(req);

      if (!token) {
        throw ApiError.unauthorized('No refresh token was provided');
      }

      const result = await service.refresh(token, sessionContext(req));

      setRefreshCookie(res, result.tokens.refreshToken);
      sendSuccess(res, 200, { user: result.user, ...result.tokens });
    },

    /** POST /api/auth/logout */
    async logout(req: Request, res: Response): Promise<void> {
      const token = readRefreshCookie(req) ?? (req.body as { refreshToken?: string } | undefined)?.refreshToken;

      await service.logout(token);
      clearRefreshCookie(res);

      sendSuccess(res, 200, { loggedOut: true });
    },

    /** POST /api/auth/logout-all */
    async logoutAll(req: Request, res: Response): Promise<void> {
      const user = requireAuthUser(req);

      const revoked = await service.logoutEverywhere(user.id);
      clearRefreshCookie(res);

      sendSuccess(res, 200, { loggedOutEverywhere: true, revokedSessions: revoked });
    },

    /** GET /api/auth/me */
    async me(req: Request, res: Response): Promise<void> {
      const user = requireAuthUser(req);

      sendSuccess(res, 200, await service.currentUser(user.id));
    },
  };
}

export type AuthController = ReturnType<typeof createAuthController>;

/**
 * Records where a login came from, so a user can later see "signed in from
 * Chrome on Windows" and notice an unfamiliar session.
 *
 * Trust warning: `req.ip` is only as trustworthy as the network in front of us.
 * Without `app.set('trust proxy', ...)` it is the socket address; behind a load
 * balancer it becomes the proxy's address instead of the client's. Recorded for
 * auditing only -- no access decision depends on it.
 */
function sessionContext(req: Request): SessionContext {
  return {
    userAgent: req.get('user-agent') ?? null,
    ipAddress: req.ip ?? null,
  };
}

/** Reads the refresh cookie off the request. */
function readRefreshCookie(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[config.jwt.refreshCookieName];
}

/**
 * COOKIE FLAGS -- this is where most of the real protection lives.
 *
 * httpOnly   JavaScript cannot read the cookie. This is the single flag that
 *            stops an XSS bug from stealing the refresh token. The access token
 *            is still returned in the body (the SPA needs it in memory), which
 *            is why this flag matters so much.
 * secure     Only sent over HTTPS. Without it the token would go out in clear
 *            text on every request.
 * sameSite   'strict' means the browser never attaches the cookie to a request
 *            triggered by another site. That defeats classic CSRF against the
 *            refresh endpoint.
 * path       Scoped to the auth routes: the cookie is not attached to ordinary
 *            API calls, so it has the fewest possible chances to leak.
 *
 * Note on the `__Host-` prefix: it is the strongest naming convention available,
 * because browsers refuse to accept such a cookie unless it is `Secure`,
 * `Path=/` and has no `Domain`. Those two requirements conflict with the
 * `path: '/api/auth'` scoping above, so the cookie is named plainly
 * (`AUTH_COOKIE_NAME`) instead. Choosing the scope over the prefix is the right
 * trade-off for an API served on a subpath; switching to `__Host-` means
 * widening the path to `/`.
 */
function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/api/auth',
    // maxAge is MILLISECONDS, unlike the token TTL strings ("7d") which are
    // parsed by secondsUntilExpiry(). Cookie lifetime and token lifetime must
    // match, otherwise the browser keeps (or drops) a cookie the server has
    // already stopped honouring.
    maxAge: secondsUntilExpiry(config.jwt.refreshTtl) * 1000,
  };
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(config.jwt.refreshCookieName, token, refreshCookieOptions());
}

/** Logging out must clear the cookie using the SAME options it was set with. */
function clearRefreshCookie(res: Response): void {
  res.clearCookie(config.jwt.refreshCookieName, refreshCookieOptions());
}