import { randomUUID } from 'node:crypto';
import type {
  CreateItemInput,
  Item,
  ListItemsQuery,
  UpdateItemInput,
} from '../../types/item';
import type { CountedItems } from './countedItems';
import type { ItemRepository } from './itemRepository';

/**
 * An ItemRepository backed by a plain JavaScript array.
 *
 * Used by the automated tests (fast, no PostgreSQL server required) and by anyone
 * who just wants to poke at the API with Postman before installing a database.
 *
 * It implements EXACTLY the same interface as PostgresItemRepository, which is
 * the whole point: the API cannot tell the difference.
 */
export class InMemoryItemRepository implements ItemRepository {
  private readonly items = new Map<string, Item>();

  constructor(seed: Item[] = []) {
    for (const item of seed) {
      this.items.set(item.id, item);
    }
  }

  async findAll(query: ListItemsQuery): Promise<CountedItems> {
    const { status, title, page = 1, pageSize = 20 } = query;
    const needle = title?.trim().toLowerCase();

    // `Array.prototype.filter` keeps the rows where the callback returned true.
    const matching = [...this.items.values()].filter((item) => {
      if (status && item.status !== status) return false;
      if (needle && !item.title.toLowerCase().includes(needle)) return false;
      return true;
    });

    // Newest first, so the ordering is predictable and matches Postgres.
    matching.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const start = (page - 1) * pageSize;

    return {
      items: matching.slice(start, start + pageSize),
      // The TOTAL number of matches, before pagination.
      total: matching.length,
    };
  }

  async findById(id: string): Promise<Item | null> {
    return this.items.get(id) ?? null;
  }

  async create(input: CreateItemInput): Promise<Item> {
    const now = new Date().toISOString();

    const item: Item = {
      id: randomUUID(),
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? 'todo',
      createdAt: now,
      updatedAt: now,
    };

    this.items.set(item.id, item);
    return item;
  }

  async update(id: string, input: UpdateItemInput): Promise<Item | null> {
    const existing = this.items.get(id);
    if (!existing) return null;

    const updated: Item = {
      ...existing,
      // Only overwrite keys that were actually provided, so PATCH does not
      // wipe fields the client did not mention.
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.status !== undefined && { status: input.status }),
      updatedAt: new Date().toISOString(),
    };

    this.items.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    return this.items.delete(id);
  }

  /** Test helper: forget everything. */
  clear(): void {
    this.items.clear();
  }

  /** Test helper: how many rows are stored right now. */
  size(): number {
    return this.items.size;
  }
}