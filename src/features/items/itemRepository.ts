import type {
  CreateItemInput,
  Item,
  ItemStatus,
  ListItemsQuery,
  UpdateItemInput,
} from '../../types/item';
import type { CountedItems } from './countedItems';

/**
 * =============================================================================
 * THE REPOSITORY INTERFACE
 * =============================================================================
 *
 * A "repository" is just a class that knows how to read/write Items in storage.
 *
 * We declare the shape here as an INTERFACE and TypeScript enforces that every
 * implementation matches it. We then ship two implementations:
 *
 *   1. PostgresItemRepository  -- real SQL against a real PostgreSQL server.
 *   2. InMemoryItemRepository  -- a plain JavaScript array. No server needed.
 *
 * The rest of the app (routes, controllers, services) only ever sees this
 * interface, so it never knows which one it got. That single trick is what makes
 * the automated tests run in milliseconds with zero setup, and it is also how you
 * would later swap in MySQL, MongoDB or Supabase without touching other files.
 *
 * ===========================================================================
 */
export interface ItemRepository {
  /** Returns a filtered, paginated list plus the total number of matches. */
  findAll(query: ListItemsQuery): Promise<CountedItems>;

  /** Returns one item, or `null` when no row has that id. */
  findById(id: string): Promise<Item | null>;

  /** Inserts a row and returns it as it now exists in storage. */
  create(input: CreateItemInput): Promise<Item>;

  /**
   * Updates only the fields present in `input`.
   * Returns `null` when no row has that id.
   */
  update(id: string, input: UpdateItemInput): Promise<Item | null>;

  /** Returns `true` if a row was deleted, `false` if the id did not exist. */
  remove(id: string): Promise<boolean>;
}

/** Re-exported so callers do not need to know about filter types separately. */
export type { ItemStatus, ListItemsQuery };