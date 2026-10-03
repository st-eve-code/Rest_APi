import { useState, type FormEvent } from 'react';
import type { ApiRequestError } from '../api/http';
import { ITEM_STATUSES, type Item, type ItemStatus } from '../types';

/** What the form holds. `description` is a string because inputs cannot be null. */
export interface FormValues {
  title: string;
  description: string;
  status: ItemStatus;
}

/**
 * Create sends the whole form; edit sends only the changed fields.
 * The union keeps both call sites honest without an `any`.
 */
export type ItemFormSubmission = FormValues | Partial<FormValues>;

const EMPTY_VALUES: FormValues = { title: '', description: '', status: 'todo' };

interface ItemFormProps {
  /** `create` posts, `edit` patches. */
  mode: 'create' | 'edit';
  /** The item being edited. Ignored when mode is 'create'. */
  item?: Item;
  /** The error from the last submit, so field messages can be shown inline. */
  error: ApiRequestError | null;
  isSubmitting: boolean;
  onSubmit: (values: ItemFormSubmission) => void;
  onCancel: () => void;
}

function toFormValues(item: Item | undefined): FormValues {
  if (!item) return EMPTY_VALUES;

  return {
    title: item.title,
    // The API models "no description" as null; the textarea needs ''.
    description: item.description ?? '',
    status: item.status,
  };
}

/**
 * One form for creating and editing.
 *
 * Server-side validation is the source of truth — the same Zod schema runs in
 * `items.validator.ts` regardless of who calls it. This form deliberately does
 * NOT duplicate the length rules; it renders whatever the server rejects and
 * highlights the offending input, so the two can never disagree.
 */
export function ItemForm({
  mode,
  item,
  error,
  isSubmitting,
  onSubmit,
  onCancel,
}: ItemFormProps) {
  const [values, setValues] = useState<FormValues>(() => toFormValues(item));
  const initial = toFormValues(item);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    // Without this the browser does a full page reload and all React state is lost.
    event.preventDefault();

    if (mode === 'create') {
      onSubmit(values);
      return;
    }

    // PATCH is partial: send only what actually changed. The server treats any
    // field that is *present* as "set it", so resending untouched fields would
    // overwrite concurrent edits made elsewhere.
    const patch: Partial<FormValues> = {};
    if (values.title !== initial.title) patch.title = values.title;
    if (values.description !== initial.description) patch.description = values.description;
    if (values.status !== initial.status) patch.status = values.status;

    // The server rejects an empty PATCH body, so this cannot produce a no-op request.
    onSubmit(patch);
  };

  const titleError = error?.errorFor('title');
  const descriptionError = error?.errorFor('description');
  const statusError = error?.errorFor('status');
  const formError = error && !error.isValidationError ? error.message : null;

  return (
    <form className="card form" onSubmit={handleSubmit} noValidate>
      <h2 className="form__title">{mode === 'create' ? 'New item' : `Edit “${item?.title}”`}</h2>

      {formError && (
        <p className="alert alert--error" role="alert">
          {formError}
        </p>
      )}

      <label className="field">
        <span className="field__label">Title</span>
        <input
          className={`field__input${titleError ? ' field__input--invalid' : ''}`}
          name="title"
          // `required` is a hint for the browser's own bubble; noValidate on the
          // form means our styled error is the one the user actually sees.
          required
          maxLength={200}
          value={values.title}
          onChange={(e) => setValues({ ...values, title: e.target.value })}
          aria-invalid={Boolean(titleError)}
        />
        {titleError && <span className="field__error">{titleError}</span>}
      </label>

      <label className="field">
        <span className="field__label">
          Description <span className="field__optional">(optional)</span>
        </span>
        <textarea
          className={`field__input field__input--textarea${descriptionError ? ' field__input--invalid' : ''}`}
          name="description"
          rows={3}
          maxLength={2000}
          value={values.description}
          onChange={(e) => setValues({ ...values, description: e.target.value })}
          aria-invalid={Boolean(descriptionError)}
        />
        {descriptionError && <span className="field__error">{descriptionError}</span>}
      </label>

      <label className="field">
        <span className="field__label">Status</span>
        <select
          className={`field__input${statusError ? ' field__input--invalid' : ''}`}
          name="status"
          value={values.status}
          onChange={(e) => setValues({ ...values, status: e.target.value as ItemStatus })}
          aria-invalid={Boolean(statusError)}
        >
          {ITEM_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        {statusError && <span className="field__error">{statusError}</span>}
      </label>

      <div className="form__actions">
        <button type="button" className="button" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </button>
        <button type="submit" className="button button--primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : mode === 'create' ? 'Create item' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}