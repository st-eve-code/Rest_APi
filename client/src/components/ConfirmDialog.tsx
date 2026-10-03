interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  isBusy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asks before destroying something.
 *
 * This exists because `DELETE /api/items/:id` cannot be undone and in-memory
 * mode makes the mistake permanent. It is a native <dialog> so focus trapping,
 * Escape-to-close and the backdrop come from the browser instead of from us.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  isBusy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <dialog className="dialog" open aria-labelledby="confirm-dialog-title">
      <h2 id="confirm-dialog-title" className="dialog__title">
        {title}
      </h2>
      <p className="dialog__message">{message}</p>
      <div className="dialog__actions">
        <button type="button" className="button" onClick={onCancel} disabled={isBusy}>
          Cancel
        </button>
        <button
          type="button"
          className="button button--danger"
          onClick={onConfirm}
          disabled={isBusy}
        >
          {isBusy ? 'Deleting…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}