import { useCallback, useEffect, useState } from 'react';
import { currentUser, login as apiLogin, logout as apiLogout, register as apiRegister } from '../api/auth';
import { ApiRequestError } from '../api/http';
import { getAccessToken, onSessionEnded } from '../api/session';
import type { AuthResult, User } from '../types';

/** What login and register have in common: two strings in, a session out. */
type AuthAction = (email: string, password: string) => Promise<AuthResult>;

export interface UseAuthResult {
  user: User | null;
  /** True while we work out whether an existing session is still valid. */
  isRestoring: boolean;
  isSubmitting: boolean;
  error: ApiRequestError | null;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

/**
 * Owns "is anybody signed in, and who".
 *
 * The interesting part is session RESTORING. A page reload throws away React
 * state but keeps sessionStorage, so the token may still be valid -- and asking
 * the server who we are is the only honest way to find out. Trusting the
 * decoded token instead would work right up until the signing secret changed or
 * the account was disabled, which is precisely when it matters.
 *
 * `onSessionEnded` closes the other gap: if the token dies mid-session (a 401
 * that refresh could not fix), this hook hears about it and drops the user, so
 * the UI never sits there showing an items table it can no longer load.
 */
export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<User | null>(null);
  const [isRestoring, setIsRestoring] = useState(() => getAccessToken() !== null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    if (!getAccessToken()) {
      setIsRestoring(false);
      return;
    }

    let cancelled = false;

    currentUser()
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch(() => {
        // A rejected token simply means signed out. Not worth an error banner:
        // the login form below is the message.
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsRestoring(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      onSessionEnded(() => {
        setUser(null);
        setError(null);
      }),
    [],
  );

  /** Shared by login and register: run it, remember the user, report success. */
  const authenticate = useCallback(
    async (email: string, password: string, action: AuthAction) => {
      setIsSubmitting(true);
      setError(null);

      try {
        const result = await action(email, password);
        setUser(result.user);
        return true;
      } catch (cause) {
        setError(
          cause instanceof ApiRequestError
            ? cause
            : new ApiRequestError(0, 'ERROR', 'Could not sign in. Is the API running?'),
        );
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [],
  );

  const login = useCallback(
    (email: string, password: string) => authenticate(email, password, apiLogin),
    [authenticate],
  );

  const register = useCallback(
    (email: string, password: string) => authenticate(email, password, apiRegister),
    [authenticate],
  );

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return { user, isRestoring, isSubmitting, error, login, register, logout };
}