/**
 * The single source of truth for what an "Item" looks like.
 *
 * Every layer (route -> validator -> service -> repository -> database)
 * imports these types from here, so renaming a field only has to happen once.
 */

/** The only values `status` is allowed to have. */
export const ITEM_STATUSES = ['todo', 'in_progress', 'done'] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** A row coming out of the database (snake_case = how SQL names columns). */
export interface Item {
  id: string;
  title: string;
  description: string | null;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
}

/** What `POST /api/items` accepts. */
export interface CreateItemInput {
  title: string;
  description?: string | null;
  status?: ItemStatus;
}

/** What `PATCH /api/items/:id` accepts. Every field is optional. */
export interface UpdateItemInput {
  title?: string;
  description?: string | null;
  status?: ItemStatus;
}

/**
 * Filters accepted by `GET /api/items`.
 * These arrive as *strings* from the URL, so they get validated separately.
 */
export interface ListItemsQuery {
  status?: ItemStatus;
  title?: string;
  page?: number;
  pageSize?: number;
}