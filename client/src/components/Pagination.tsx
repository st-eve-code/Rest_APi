import type { PaginationMeta } from '../types';

interface PaginationProps {
  meta: PaginationMeta;
  isBusy: boolean;
  onPageChange: (page: number) => void;
}

/**
 * Page controls driven entirely by the server's `meta` block.
 *
 * The client never computes totals from the rows it happens to be holding —
 * `meta.total` and `meta.totalPages` come from the COUNT query in
 * `postgresItemRepository.findAll`, which is the only place that knows how many
 * rows match in total. Recomputing here would silently be wrong the moment a
 * filter is active.
 */
export function Pagination({ meta, isBusy, onPageChange }: PaginationProps) {
  if (meta.total === 0) return null;

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="button"
        onClick={() => onPageChange(meta.page - 1)}
        disabled={isBusy || !meta.hasPreviousPage}
      >
        ← Previous
      </button>

      <span className="pagination__status">
        Page {meta.page} of {Math.max(meta.totalPages, 1)} · {meta.total}{' '}
        {meta.total === 1 ? 'item' : 'items'}
      </span>

      <button
        type="button"
        className="button"
        onClick={() => onPageChange(meta.page + 1)}
        disabled={isBusy || !meta.hasNextPage}
      >
        Next →
      </button>
    </nav>
  );
}