/**
 * These types mirror `src/types/item.ts` and `src/lib/ApiResponse.js` on the
 * server. They are duplicated on purpose, NOT shared:
 *
 *   - The server compiles to CommonJS for Node; the client is bundled by Vite
 *     for the browser. A single file cannot serve both module systems cleanly.
 *   - Keeping a copy here means the client documents the contract it expects,
 *     and `npm run typecheck` fails loudly if the server's shape drifts.
 *
 * If you change the API response shape, change it here too.
 */

/** The only values `status` is allowed to have (server: ITEM_STATUSES). */
export const ITEM_STATUSES = ['todo', 'in_progress', 'done'] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

export interface Item {
  id: string;
  title: string;
  description: string | null;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
}

/** Body accepted by `POST /api/items`. */
export interface CreateItemInput {
  title: string;
  description?: string | null;
  status?: ItemStatus;
}

/** Body accepted by `PATCH /api/items/:id`. Every field is optional. */
export interface UpdateItemInput {
  title?: string;
  description?: string | null;
  status?: ItemStatus;
}

/** Query accepted by `GET /api/items`. */
export interface ListItemsParams {
  status?: ItemStatus;
  title?: string;
  page?: number;
  pageSize?: number;
}

/** `{ success: true, data, meta? }` -- see lib/ApiResponse.js. */
export interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

/** `{ success: false, error: { code, message, details? } }` */
export interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** The `meta` block the server attaches to every list response. */
export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * One field-level validation problem.
 *
 * The server sends these in two shapes depending on which validator produced
 * them, so the client normalises both into this one shape:
 *   - `[{ field, message }]`  from `validate()` in items.validator.ts
 *   - `{ field: message }`    from formatZodIssues() in middleware/errorHandler.ts
 */
export interface FieldError {
  field: string;
  message: string;
}