import type {
  CreateItemInput,
  Item,
  ListItemsParams,
  PaginationMeta,
  UpdateItemInput,
} from '../types';
import { request, requestWithMeta } from './http';

/**
 * One function per endpoint. Nothing above this file knows a URL or an HTTP
 * method, and nothing below it knows what an "item" is -- swapping this API for
 * REST/GraphQL/localStorage would only touch this file.
 */

/**
 * Serialises filters into a query string, dropping anything empty.
 *
 * Empty values are omitted rather than sent as `?title=` because the server
 * validates `title` with `.min(1)` and would reject a blank one.
 */
function toQueryString(params: ListItemsParams): string {
  const search = new URLSearchParams();

  if (params.status) search.set('status', params.status);
  if (params.title?.trim()) search.set('title', params.title.trim());
  if (params.page !== undefined) search.set('page', String(params.page));
  if (params.pageSize !== undefined) search.set('pageSize', String(params.pageSize));

  const query = search.toString();
  return query ? `?${query}` : '';
}

/** `GET /api/items` — a filtered, paginated page of items plus its meta. */
export async function listItems(
  params: ListItemsParams,
  signal?: AbortSignal,
): Promise<{ items: Item[]; meta: PaginationMeta }> {
  const { data, meta } = await requestWithMeta<Item[]>(`/items${toQueryString(params)}`, {
    signal,
  });

  // The server always sends `meta` on this endpoint. The fallback exists only so
  // a missing block cannot render the page as "undefined" while typing.
  return {
    items: data,
    meta: meta ?? {
      total: data.length,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      totalPages: data.length > 0 ? 1 : 0,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
}

/** `GET /api/items/:id` */
export async function getItem(id: string, signal?: AbortSignal): Promise<Item> {
  return request<Item>(`/items/${encodeURIComponent(id)}`, { signal });
}

/** `POST /api/items` */
export async function createItem(input: CreateItemInput): Promise<Item> {
  return request<Item>('/items', { method: 'POST', body: input });
}

/**
 * `PATCH /api/items/:id`
 *
 * Only the fields the user actually changed are sent. That matters: the server
 * treats a field that is *present* as "set it to this", so sending
 * `description: null` would clear a description the user never touched.
 */
export async function updateItem(id: string, input: UpdateItemInput): Promise<Item> {
  return request<Item>(`/items/${encodeURIComponent(id)}`, { method: 'PATCH', body: input });
}

/** `DELETE /api/items/:id` — responds 204 with no body. */
export async function deleteItem(id: string): Promise<void> {
  await request<void>(`/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
}