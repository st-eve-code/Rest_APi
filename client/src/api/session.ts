/**
 * =============================================================================
 * WHERE THE TOKENS LIVE IN THE BROWSER
 * =============================================================================
 *
 * Two tokens, two very different storage strategies:
 *
 * ACCESS TOKEN  kept in memory (and mirrored in sessionStorage so a page reload
 *               does not log you out). Read by JavaScript on every request --
 *               it has to be, since it goes in an Authorization header.
 *
 * REFRESH TOKEN never touched by JavaScript at all. The server sets it as an
 *               httpOnly cookie, which the browser attaches to /api/auth/*
 *               automatically. A bug in our code (or an injected script) cannot
 *               read it, so the worst an XSS can steal is a 15-minute access
 *               token -- not a week-long session.
 *
 * That is the entire reason the server sets BOTH the cookie and the response
 * body: native apps and Postman have no cookie jar, so they need the body, while
 * the web client deliberately ignores it. See SECURITY_NOTES.md.
 *
 * sessionStorage rather than localStorage: localStorage survives closing the
 * browser, which would silently keep people signed in on a shared machine.
 * sessionStorage dies with the tab.
 *
 * ===========================================================================
 */

const ACCESS_TOKEN_KEY = 'ado.auth.accessToken';
const EXPIRES_AT_KEY = 'ado.auth.expiresAt';

export interface SessionTokens {
  accessToken: string;
  /** Epoch milliseconds, so we can refresh BEFORE the server starts refusing. */
  expiresAt: number;
}

/** How long before actual expiry we refresh. Avoids racing the 401. */
const REFRESH_MARGIN_MS = 30_000;

/** Notified when the session is gone for good, so the UI can show the login form. */
type SessionListener = () => void;

const listeners = new Set<SessionListener>();

export function onSessionEnded(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announceSessionEnded(): void {
  for (const listener of listeners) listener();
}

/**
 * Returns the stored access token, or null if there is none or it has expired.
 *
 * Reading does NOT refresh. Refreshing is `refreshIfNeeded`'s job, and keeping
 * the two separate stops a plain "read the token" from triggering a network
 * call in the middle of rendering.
 */
export function getAccessToken(): string | null {
  const token = readStorage(ACCESS_TOKEN_KEY);
  const expiresAt = Number(readStorage(EXPIRES_AT_KEY));

  if (!token || !Number.isFinite(expiresAt)) return null;

  if (Date.now() >= expiresAt) {
    // Expired locally: drop it so nothing tries to send it, and let the next
    // request trigger a refresh.
    writeSession(null);
    return null;
  }

  return token;
}

/** Stores a new pair. The refresh token is NOT stored here -- the cookie owns it. */
export function writeSession(tokens: SessionTokens | null): void {
  if (tokens === null) {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(EXPIRES_AT_KEY);
    return;
  }

  sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  sessionStorage.setItem(EXPIRES_AT_KEY, String(tokens.expiresAt));
}

/** True when the token is expired, or close enough that it should be renewed. */
function isAccessTokenExpiring(): boolean {
  const expiresAt = Number(readStorage(EXPIRES_AT_KEY));
  if (!Number.isFinite(expiresAt)) return true;

  return Date.now() >= expiresAt - REFRESH_MARGIN_MS;
}

/** Forgets the tokens and tells the app the user is signed out. */
export function clearSession(): void {
  writeSession(null);
  announceSessionEnded();
}

/**
 * Exchanges the httpOnly refresh cookie for a new access token.
 *
 * This is the only place that talks to /api/auth/refresh, and it uses `fetch`
 * directly rather than the shared `request()` helper -- otherwise http.ts would
 * have to import this module to retry on 401, while this module needs http.ts's
 * error parsing. A cycle between them would be a runtime mess.
 *
 * `credentials: 'include'` is what makes the browser send the cookie. It is not
 * needed for same-origin requests in modern browsers, but stating it makes the
 * requirement explicit and keeps the code working if the API is ever moved to a
 * different origin.
 *
 * Concurrent callers share ONE refresh: three parallel 401s must not each try to
 * rotate the same refresh token, because rotation is single-use and the second
 * attempt would be flagged as a stolen-token replay (see auth.service.ts).
 */
let inFlightRefresh: Promise<string | null> | null = null;

export async function refreshIfNeeded(): Promise<string | null> {
  if (!isAccessTokenExpiring()) return getAccessToken();
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        // The refresh cookie is gone, expired or revoked. Nothing can be done
        // automatically -- the user has to sign in again.
        clearSession();
        return null;
      }

      const body = (await response.json()) as { data?: { accessToken?: string; expiresIn?: number } };
      const accessToken = body.data?.accessToken;
      const expiresIn = body.data?.expiresIn;

      if (typeof accessToken !== 'string' || typeof expiresIn !== 'number') {
        clearSession();
        return null;
      }

      writeSession({ accessToken, expiresAt: Date.now() + expiresIn * 1000 });
      return accessToken;
    } catch {
      // Network failure, not an auth problem: keep whatever we have and let the
      // retry fail with a normal error rather than dumping the user at a login
      // screen because their wifi blipped.
      return getAccessToken();
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

/**
 * sessionStorage throws in private-mode Safari and when storage is disabled.
 * A storage failure must not break authentication, so every access is guarded.
 */
function readStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}