import type { Item } from '../types';

interface ItemTableProps {
  items: Item[];
  isLoading: boolean;
  isFiltered: boolean;
  editingId: string | null;
  onEdit: (item: Item) => void;
  onDelete: (item: Item) => void;
}

/** `2026-01-31T09:15:00.000Z` -> `31 Jan 2026, 09:15`. */
function formatDate(iso: string): string {
  const date = new Date(iso);

  // An unparseable date should show something honest rather than "Invalid Date".
  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The list, with row actions.
 *
 * The three states are distinguished on purpose: "loading" and "no results" look
 * identical otherwise, and a blank table with no explanation is the most
 * confusing thing a data table can do.
 */
export function ItemTable({
  items,
  isLoading,
  isFiltered,
  editingId,
  onEdit,
  onDelete,
}: ItemTableProps) {
  if (isLoading) {
    return <p className="state">Loading items…</p>;
  }

  if (items.length === 0) {
    return (
      <p className="state">
        {isFiltered
          ? 'No items match these filters.'
          : 'No items yet. Use “New item” to create the first one.'}
      </p>
    );
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">Title</th>
          <th scope="col">Description</th>
          <th scope="col">Status</th>
          <th scope="col">Created</th>
          <th scope="col">
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className={editingId === item.id ? 'table__row--editing' : undefined}>
            <td data-label="Title" className="table__title">
              {item.title}
            </td>
            <td data-label="Description" className="table__muted">
              {item.description ?? <em>none</em>}
            </td>
            <td data-label="Status">
              <span className={`badge badge--${item.status}`}>{item.status}</span>
            </td>
            <td data-label="Created" className="table__muted">
              {formatDate(item.createdAt)}
            </td>
            <td data-label="Actions" className="table__actions">
              <button
                type="button"
                className="button button--small"
                onClick={() => onEdit(item)}
              >
                Edit
              </button>
              <button
                type="button"
                className="button button--small button--danger"
                onClick={() => onDelete(item)}
              >
                Delete
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}