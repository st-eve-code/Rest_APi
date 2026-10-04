import { useState, type FormEvent } from 'react';
import type { ApiRequestError } from '../api/http';

interface AuthFormProps {
  mode: 'login' | 'register';
  error: ApiRequestError | null;
  isSubmitting: boolean;
  onSubmit: (email: string, password: string) => void;
  onSwitchMode: () => void;
}

/**
 * Sign in / sign up.
 *
 * This screen exists because every `/api/items` route now requires a bearer
 * token. Until the user authenticates there is nothing to show.
 *
 * Note what it does NOT do: validate the password locally. The server owns
 * password policy (12 characters, three character classes -- see
 * `auth.validator.ts`), and duplicating that rule here is how the two drift
 * apart. The form renders whatever the server says, next to the right input.
 */
export function AuthForm({ mode, error, isSubmitting, onSubmit, onSwitchMode }: AuthFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(email.trim(), password);
  };

  const emailError = error?.errorFor('email');
  const passwordError = error?.errorFor('password');
  // A 401 is a wrong email/password, not a form problem, so it gets a banner
  // rather than being pinned to an input the user cannot fix by retyping it.
  const formError = error && !error.isValidationError ? error.message : null;

  return (
    <div className="app app--auth">
      <form className="card form" onSubmit={handleSubmit} noValidate>
        <h1 className="form__title">{mode === 'login' ? 'Sign in' : 'Create an account'}</h1>

        <p className="form__hint">
          <code>/api/items</code> is protected, so an account is needed to continue.
        </p>

        {formError && (
          <p className="alert alert--error" role="alert">
            {formError}
          </p>
        )}

        <label className="field">
          <span className="field__label">Email</span>
          <input
            className={`field__input${emailError ? ' field__input--invalid' : ''}`}
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(emailError)}
          />
          {emailError && <span className="field__error">{emailError}</span>}
        </label>

        <label className="field">
          <span className="field__label">Password</span>
          <input
            className={`field__input${passwordError ? ' field__input--invalid' : ''}`}
            name="password"
            type="password"
            // `current-password` / `new-password` let password managers offer the
            // right action and stop offering to save a login we just created.
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(passwordError)}
          />
          {passwordError && <span className="field__error">{passwordError}</span>}
        </label>

        <div className="form__actions">
          <button type="button" className="button" onClick={onSwitchMode} disabled={isSubmitting}>
            {mode === 'login' ? 'Need an account?' : 'Have an account?'}
          </button>
          <button type="submit" className="button button--primary" disabled={isSubmitting}>
            {isSubmitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Sign up'}
          </button>
        </div>
      </form>
    </div>
  );
}