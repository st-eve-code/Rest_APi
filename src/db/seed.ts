import { randomUUID } from 'node:crypto';
import { closePool, pool } from './pool';
import { hashPassword } from '../features/auth/password';
import type { ItemStatus } from '../types/item';

/**
 * Inserts a few example rows so you have something to look at in Postman.
 *
 *   npm run db:seed
 *
 * It TRUNCATEs first, so it is safe (and expected) to run repeatedly -- but that
 * also means it DESTROYS YOUR DATA. Never point it at a real database.
 */

/**
 * The demo account.
 *
 * `POST /api/auth/register` is open to anyone, so a fresh database has no way in
 * at all until somebody signs up. These credentials exist so you can log in
 * immediately after seeding.
 *
 * The password is hashed with the same bcrypt function the real login path uses
 * -- seeding a pre-computed hash string would risk drifting from it.
 *
 * These are LOCAL DEMO credentials. Change the email before deploying, or delete
 * the row: anyone can log in with them.
 */
const DEMO_USER = {
  email: 'demo@example.com',
  password: 'Correct-Horse-42',
  role: 'admin' as const,
};

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

  await seedDemoUser();
}

/**
 * Creates the demo account if it is not already there.
 *
 * `ON CONFLICT DO NOTHING` on the email index means re-seeding does not fail and
 * does not overwrite the password of an account you have since changed -- which
 * matters, because re-running the seed is the normal way to reset a dev database.
 */
async function seedDemoUser(): Promise<void> {
  const passwordHash = await hashPassword(DEMO_USER.password);

  const result = await pool.query(
    `INSERT INTO users (email, password_hash, role)
          VALUES ($1, $2, $3::user_role)
     ON CONFLICT DO NOTHING
          RETURNING email`,
    [DEMO_USER.email, passwordHash, DEMO_USER.role],
  );

  if (result.rowCount === 0) {
    console.log(`[seed] demo user already exists (${DEMO_USER.email}) -- left alone`);
    return;
  }

  console.log(`[seed] created demo user ${DEMO_USER.email} / ${DEMO_USER.password} (${DEMO_USER.role})`);
}

seed()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    console.error('[seed] failed:', error instanceof Error ? error.message : error);
    await closePool().catch(() => undefined);
    process.exit(1);
  });