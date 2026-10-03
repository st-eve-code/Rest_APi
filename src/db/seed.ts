import { randomUUID } from 'node:crypto';
import { closePool, pool } from './pool';
import type { ItemStatus } from '../types/item';

/**
 * Inserts a few example rows so you have something to look at in Postman.
 *
 *   npm run db:seed
 *
 * It TRUNCATEs first, so it is safe (and expected) to run repeatedly -- but that
 * also means it DESTROYS YOUR DATA. Never point it at a real database.
 */

const SAMPLE_ITEMS: Array<{
  title: string;
  description: string | null;
  status: ItemStatus;
}> = [
  {
    title: 'Wire up the payments webhook',
    description: 'Handle Stripe events and update order status.',
    status: 'todo',
  },
  {
    title: 'Fix pagination on the orders screen',
    description: 'Page 2 renders the same items as page 1.',
    status: 'in_progress',
  },
  {
    title: 'Add rate limiting to the public API',
    description: 'Already done and deployed.',
    status: 'done',
  },
  {
    title: 'Write integration tests for auth',
    description: null,
    status: 'todo',
  },
];

async function seed(): Promise<void> {
  console.log('[seed] clearing the items table');
  await pool.query('TRUNCATE TABLE items RESTART IDENTITY CASCADE');

  for (const item of SAMPLE_ITEMS) {
    await pool.query(
      `INSERT INTO items (id, title, description, status)
            VALUES ($1, $2, $3, $4::item_status)`,
      [randomUUID(), item.title, item.description, item.status],
    );
  }

  const { rows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM items',
  );

  console.log(`[seed] inserted ${SAMPLE_ITEMS.length} items (table now has ${rows[0].count})`);
}

seed()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    console.error('[seed] failed:', error instanceof Error ? error.message : error);
    await closePool().catch(() => undefined);
    process.exit(1);
  });