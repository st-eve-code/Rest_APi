import { useState } from 'react';
import { ApiRequestError } from './api/http';
import { createItem, deleteItem, updateItem } from './api/items';
import { Alert } from './components/Alert';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Filters } from './components/Filters';
import { ItemForm, type ItemFormSubmission } from './components/ItemForm';
import { ItemTable } from './components/ItemTable';
import { Pagination } from './components/Pagination';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { useItems, type ItemFilters } from './hooks/useItems';
import type { Item } from './types';

const DEFAULT_FILTERS: ItemFilters = { status: '', title: '', page: 1, pageSize: 20 };

/**
 * The whole screen, composed from the pieces below it.
 *
 * It owns two things and nothing else:
 *   - WHICH items are shown  (delegated to the `useItems` hook)
 *   - what the user is doing  (creating / editing / deleting / browsing)
 *
 * Every mutation follows the same three steps: call the API, refresh the list,
 * report the outcome. Keeping that order identical is what stops the UI from
 * showing a row that the server rejected.
 */
export default function App() {
  const [filters, setFilters] = useState<ItemFilters>(DEFAULT_FILTERS);

  // Typing stays instant; the request waits for the user to pause.
  const debouncedTitle = useDebouncedValue(filters.title);
  const { items, meta, isLoading, error: loadError, refresh } = useItems({
    ...filters,
    title: debouncedTitle,
  });

  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ApiRequestError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isFormOpen = isCreating || editingItem !== null;

  const closeForm = () => {
    setIsCreating(false);
    setEditingItem(null);
    setSubmitError(null);
  };

  /** Translates a thrown value into something worth showing a user. */
  const describe = (cause: unknown): string =>
    cause instanceof ApiRequestError ? cause.message : 'Something went wrong';

  const handleCreate = async (values: ItemFormSubmission) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const { title, description, status } = values as {
        title: string;
        description: string;
        status: Item['status'];
      };

      const created = await createItem({
        title,
        // The API treats "" as null, but sending null explicitly keeps the
        // request honest and matches what the server stores.
        description: description.trim() === '' ? null : description,
        status,
      });

      // Clear filters and jump to page 1. Without this, creating an item while
      // a status filter is active would appear to do nothing, because the new
      // row would not match the filter.
      setFilters({ ...DEFAULT_FILTERS, pageSize: filters.pageSize });
      closeForm();
      setNotice(`Created “${created.title}”.`);
      refresh();
    } catch (cause) {
      // Keep the form open with the field errors visible so the user can fix
      // the input instead of retyping everything.
      setSubmitError(
        cause instanceof ApiRequestError ? cause : new ApiRequestError(0, 'ERROR', describe(cause)),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (values: ItemFormSubmission) => {
    if (!editingItem) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const updated = await updateItem(editingItem.id, values);
      closeForm();
      setNotice(`Updated “${updated.title}”.`);
      refresh();
    } catch (cause) {
      setSubmitError(
        cause instanceof ApiRequestError ? cause : new ApiRequestError(0, 'ERROR', describe(cause)),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteItem(deleteTarget.id);
      setNotice(`Deleted “${deleteTarget.title}”.`);
      setDeleteTarget(null);

      // Deleting the only row on the last page would otherwise leave the user
      // staring at an empty page with a "Next" button that goes nowhere.
      if (items.length === 1 && filters.page > 1) {
        setFilters({ ...filters, page: filters.page - 1 });
      } else {
        refresh();
      }
    } catch (cause) {
      setDeleteError(describe(cause));
    } finally {
      setIsDeleting(false);
    }
  };

  const isFiltered = filters.status !== '' || filters.title.trim() !== '';

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1 className="app__title">Items</h1>
          <p className="app__subtitle">
            CRUD interface for <code>GET/POST/PATCH/DELETE /api/items</code>
          </p>
        </div>

        {!isFormOpen && (
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              setNotice(null);
              setIsCreating(true);
            }}
          >
            New item
          </button>
        )}
      </header>

      {notice && <Alert kind="success" message={notice} onDismiss={() => setNotice(null)} />}
      {loadError && <Alert kind="error" message={loadError} />}

      {isCreating && (
        <ItemForm
          // Remounting on open resets the fields. Without the key, the form
          // would keep the values from the last item that was created.
          key="create"
          mode="create"
          error={submitError}
          isSubmitting={isSubmitting}
          onSubmit={handleCreate}
          onCancel={closeForm}
        />
      )}

      {editingItem && (
        <ItemForm
          key={editingItem.id}
          mode="edit"
          item={editingItem}
          error={submitError}
          isSubmitting={isSubmitting}
          onSubmit={handleUpdate}
          onCancel={closeForm}
        />
      )}

      <Filters
        filters={filters}
        onChange={(next) => {
          setNotice(null);
          setFilters(next);
        }}
        onReset={() => setFilters({ ...DEFAULT_FILTERS, pageSize: filters.pageSize })}
      />

      <div className="app__list">
        <ItemTable
          items={items}
          isLoading={isLoading}
          isFiltered={isFiltered}
          editingId={editingItem?.id ?? null}
          onEdit={(item) => {
            setNotice(null);
            setSubmitError(null);
            setEditingItem(item);
          }}
          onDelete={(item) => {
            setNotice(null);
            setDeleteError(null);
            setDeleteTarget(item);
          }}
        />

        {meta && (
          <Pagination
            meta={meta}
            isBusy={isLoading}
            onPageChange={(page) => setFilters({ ...filters, page })}
          />
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this item?"
          message={`“${deleteTarget.title}” will be permanently removed. This cannot be undone.`}
          confirmLabel="Delete"
          isBusy={isDeleting}
          onConfirm={handleDelete}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
        />
      )}

      {deleteError && <Alert kind="error" message={deleteError} />}
    </div>
  );
}