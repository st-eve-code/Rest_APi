import type { AuthResult, User } from '../types';
import { request } from './http';
import { clearSession, writeSession } from './session';

/**
 * One function per auth endpoint, matching api/items.ts in style.
 *
 * The shared pattern here is `storeSession`: every endpoint that returns tokens
 * hands them to the session store, and forgets about them. Nothing else in the
 * app ever touches a token, so there is exactly one place that decides how long
 * a login lasts.
 */

/**
 * Remembers a fresh token pair.
 *
 * Only the ACCESS token is stored. The refresh token arrives in the body too, and
 * deliberately so: native apps and tools like Postman have no cookie jar and
 * would otherwise have no way to refresh. In the browser we ignore the body's
 * copy and let the httpOnly cookie do its job -- a token that JavaScript can
 * read is a token that XSS can steal.
 */
function storeSession(result: AuthResult): AuthResult {
  writeSession({
    accessToken: result.accessToken,
    expiresAt: Date.now() + result.expiresIn * 1000,
  });

  return result;
}

/** `POST /api/auth/register` */
export async function register(email: string, password: string): Promise<AuthResult> {
  return storeSession(await request<AuthResult>('/auth/register', { method: 'POST', body: { email, password } }));
}

/** `POST /api/auth/login` */
export async function login(email: string, password: string): Promise<AuthResult> {
  return storeSession(await request<AuthResult>('/auth/login', { method: 'POST', body: { email, password } }));
}

/** `POST /api/auth/logout` -- revokes the refresh session server-side. */
export async function logout(): Promise<void> {
  try {
    await request<{ loggedOut: boolean }>('/auth/logout', { method: 'POST', skipAuthRetry: true });
  } finally {
    // Clear locally even if the call failed: keeping a token we could not revoke
    // around would leave the user stuck in a state they cannot escape.
    clearSession();
  }
}

/** `POST /api/auth/logout-all` -- revokes every session for this user. */
export async function logoutEverywhere(): Promise<void> {
  try {
    await request<{ revokedSessions: number }>('/auth/logout-all', {
      method: 'POST',
      skipAuthRetry: true,
    });
  } finally {
    clearSession();
  }
}

/**
 * `GET /api/auth/me` -- who am I?
 *
 * Used on page load to decide whether the stored access token still works. A 401
 * here is the expected answer for "session expired", not an error worth showing,
 * so callers treat it as signed-out.
 */
export async function currentUser(): Promise<User> {
  return request<User>('/auth/me', { skipAuthRetry: true });
}