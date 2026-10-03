import { ITEM_STATUSES, type ItemStatus } from '../types';
import type { ItemFilters } from '../hooks/useItems';

interface FiltersProps {
  filters: ItemFilters;
  onChange: (next: ItemFilters) => void;
  onReset: () => void;
}

/**
 * The three inputs `GET /api/items` understands: status, title, pageSize.
 *
 * Page is NOT here — it is owned by the pagination component and reset to 1
 * whenever a filter changes, because staying on page 7 of a result set that now
 * has two pages is the classic "empty list, no explanation" bug.
 */
export function Filters({ filters, onChange, onReset }: FiltersProps) {
  const isFiltered = filters.status !== '' || filters.title.trim() !== '';

  return (
    <div className="filters">
      <label className="field field--inline">
        <span className="field__label">Search title</span>
        <input
          className="field__input"
          type="search"
          placeholder="contains…"
          value={filters.title}
          onChange={(e) => onChange({ ...filters, title: e.target.value, page: 1 })}
        />
      </label>

      <label className="field field--inline">
        <span className="field__label">Status</span>
        <select
          className="field__input"
          value={filters.status}
          onChange={(e) =>
            onChange({ ...filters, status: e.target.value as ItemStatus | '', page: 1 })
          }
        >
          <option value="">All</option>
          {ITEM_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>

      <label className="field field--inline">
        <span className="field__label">Per page</span>
        <select
          className="field__input"
          value={filters.pageSize}
          onChange={(e) =>
            onChange({ ...filters, pageSize: Number(e.target.value), page: 1 })
          }
        >
          {[5, 10, 20, 50].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      {isFiltered && (
        <button type="button" className="button" onClick={onReset}>
          Clear filters
        </button>
      )}
    </div>
  );
}