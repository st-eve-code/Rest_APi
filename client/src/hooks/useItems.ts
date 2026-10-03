import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '../api/http';
import { listItems } from '../api/items';
import type { Item, ItemStatus, PaginationMeta } from '../types';

export interface ItemFilters {
  status: ItemStatus | '';
  title: string;
  page: number;
  pageSize: number;
}

export interface UseItemsResult {
  items: Item[];
  meta: PaginationMeta | null;
  isLoading: boolean;
  /** Set when the last request failed. Cleared automatically on the next success. */
  error: string | null;
  /** Re-runs the current query. Called after create/update/delete. */
  refresh: () => void;
}

/**
 * Owns "which items are on screen right now".
 *
 * Two details carry the weight:
 *
 * 1. The AbortController. Filters apply instantly, so several requests can be in
 *    flight at once. Without aborting the previous one, a slow early request
 *    could resolve *after* a fast later one and overwrite the list with stale
 *    rows. Aborting makes the last request win.
 *
 * 2. `hasLoadedRef`. Refetching keeps the previous rows on screen (so paging
 *    does not blank the table), but the very first load must show a spinner.
 *    A ref, not state, because changing it must not trigger another fetch.
 */
export function useItems(filters: ItemFilters): UseItemsResult {
  const [items, setItems] = useState<Item[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const hasLoadedRef = useRef(false);

  const { status, title, page, pageSize } = filters;

  useEffect(() => {
    const controller = new AbortController();

    setIsLoading(!hasLoadedRef.current);
    setError(null);

    listItems(
      {
        status: status === '' ? undefined : status,
        title: title.trim() === '' ? undefined : title,
        page,
        pageSize,
      },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;

        setItems(result.items);
        setMeta(result.meta);
        hasLoadedRef.current = true;
      })
      .catch((cause: unknown) => {
        // An abort is our own doing, not a failure — stay silent.
        if (cause instanceof DOMException && cause.name === 'AbortError') return;

        setError(cause instanceof ApiRequestError ? cause.message : 'Something went wrong');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [status, title, page, pageSize, reloadToken]);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  return { items, meta, isLoading, error, refresh };
}