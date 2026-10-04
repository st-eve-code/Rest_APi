import { useState } from 'react';
import { AuthForm } from './components/AuthForm';
import { ItemsScreen } from './components/ItemsScreen';
import { useAuth } from './hooks/useAuth';

/**
 * The auth gate.
 *
 * Every `/api/items` route now requires a bearer token, so this component's only
 * job is deciding which of two screens to show:
 *
 *   user !== null  ->  <ItemsScreen />   the app as it always was
 *   user === null  ->  <AuthForm />      sign in or register
 *
 * The items screen is a SEPARATE component rather than an `if` further down
 * this file because React hooks cannot be called conditionally: useItems fires a
 * request on mount, and that must not happen for a visitor who is not signed in.
 *
 * `isRestoring` covers the gap between "we have a token in sessionStorage" and
 * "the server has told us who it belongs to". Rendering the login form during
 * that window would flash the wrong screen at users who are in fact signed in.
 */
export default function App() {
  const { user, isRestoring, isSubmitting, error, login, register, logout } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');

  if (isRestoring) {
    return (
      <div className="app app--auth">
        <p className="form__hint">Checking your session…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthForm
        mode={mode}
        error={error}
        isSubmitting={isSubmitting}
        onSubmit={(email, password) =>
          mode === 'login' ? void login(email, password) : void register(email, password)
        }
        onSwitchMode={() => {
          // Clear the previous error so switching forms does not carry a stale
          // "email already registered" message into the login form.
          setMode(mode === 'login' ? 'register' : 'login');
        }}
      />
    );
  }

  return <ItemsScreen user={user} onLogout={() => void logout()} />;
}