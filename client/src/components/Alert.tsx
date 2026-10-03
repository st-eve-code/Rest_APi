interface AlertProps {
  kind: 'error' | 'success';
  message: string;
  onDismiss?: () => void;
}

/**
 * A dismissible banner. Deliberately has no dismiss button of its own when
 * `onDismiss` is absent, so a permanent message (e.g. "API unreachable") cannot
 * be dismissed by the user and then look like the problem is gone.
 */
export function Alert({ kind, message, onDismiss }: AlertProps) {
  return (
    <div className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span className="alert__message">{message}</span>
      {onDismiss && (
        <button type="button" className="alert__close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}