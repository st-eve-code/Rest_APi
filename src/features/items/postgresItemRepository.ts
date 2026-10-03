import { randomUUID } from 'node:crypto';
import { query } from '../../db/pool';
import type {
  CreateItemInput,
  Item,
  ListItemsQuery,
  UpdateItemInput,
} from '../../types/item';
import type { CountedItems } from './countedItems';
import type { ItemRepository } from './itemRepository';

/** How the `items` table looks inside PostgreSQL, before we convert it to an Item. */
interface ItemRow {
  id: string;
  title: string;
  description: string | null;
  status: Item['status'];
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * `pg` returns TIMESTAMP columns as JS Date objects. Our API speaks ISO-8601
 * strings ("2026-01-31T09:15:00.000Z"), because that is what JSON wants. This is
 * the boundary where snake_case columns and Date objects become camelCase fields
 * and plain strings.
 */
export function mapRowToItem(row: ItemRow): Item {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/** The real repository: talks SQL to PostgreSQL. */
export class PostgresItemRepository implements ItemRepository {
  async findAll(filters: ListItemsQuery): Promise<CountedItems> {
    const { status, title, page = 1, pageSize = 20 } = filters;

    const where: string[] = [];
    const params: unknown[] = [];

    // Build the WHERE clause piece by piece, pushing a value onto `params` for
    // every placeholder we add. Keeping the two in lock-step is what stops
    // "wrong placeholder number" bugs.
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    if (title?.trim()) {
      params.push(`%${title.trim()}%`);
      // ILIKE = case-insensitive LIKE. The % wildcards mean "contains".
      where.push(`title ILIKE $${params.length}`);
    }

    // `where` is ["status = $1", "title ILIKE $2"] -> "WHERE status = $1 AND title ILIKE $2".
    // When there are no filters it becomes an empty string, which is valid SQL.
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    // --- Query 1: total number of matching rows (ignores pagination) ---
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM items ${whereClause}`,
      params,
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    // --- Query 2: the actual page of rows ---
    // LIMIT/OFFSET cannot be parameters in PostgreSQL, so we interpolate the
    // NUMBERS we generated ourselves (never user text -- they are ints).
    const offset = (page - 1) * pageSize;

    const rowsResult = await query<ItemRow>(
      `SELECT id, title, description, status, created_at, updated_at
         FROM items
         ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );

    return {
      items: rowsResult.rows.map(mapRowToItem),
      total,
    };
  }

  async findById(id: string): Promise<Item | null> {
    const result = await query<ItemRow>(
      `SELECT id, title, description, status, created_at, updated_at
         FROM items
        WHERE id = $1`,
      [id],
    );

    const row = result.rows[0];
    return row ? mapRowToItem(row) : null;
  }

  async create(input: CreateItemInput): Promise<Item> {
    const result = await query<ItemRow>(
      `INSERT INTO items (id, title, description, status)
            VALUES ($1, $2, $3, COALESCE($4, 'todo'::item_status))
         RETURNING id, title, description, status, created_at, updated_at`,
      [randomUUID(), input.title, input.description ?? null, input.status ?? null],
    );

    // An INSERT ... RETURNING always gives us exactly one row back.
    return mapRowToItem(result.rows[0]);
  }

  async update(id: string, input: UpdateItemInput): Promise<Item | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];

    // Add a `column = $n` assignment only for the fields the client actually sent.
    // That is what makes PATCH partial: omitted fields are left untouched, and a
    // field explicitly sent as `null` is genuinely cleared.
    if (input.title !== undefined) {
      params.push(input.title);
      sets.push(`title = $${params.length}`);
    }

    if (input.description !== undefined) {
      params.push(input.description);
      sets.push(`description = $${params.length}`);
    }

    if (input.status !== undefined) {
      params.push(input.status);
      sets.push(`status = $${params.length}`);
    }

    // PATCH with an empty body: nothing to change, so just echo the current row.
    if (sets.length === 0) {
      return this.findById(id);
    }

    sets.push('updated_at = NOW()');

    const result = await query<ItemRow>(
      `UPDATE items
          SET ${sets.join(', ')}
        WHERE id = $1
    RETURNING id, title, description, status, created_at, updated_at`,
      params,
    );

    const row = result.rows[0];
    return row ? mapRowToItem(row) : null;
  }

  async remove(id: string): Promise<boolean> {
    const result = await query('DELETE FROM items WHERE id = $1', [id]);

    // `rowCount` is how many rows the statement actually touched.
    return result.rowCount !== null && result.rowCount > 0;
  }
}