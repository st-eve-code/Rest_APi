import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closePool, pool } from './pool';

/**
 * Applies db/schema.sql to the database.
 *
 *   npm run db:migrate
 *
 * Every statement in schema.sql is written with IF NOT EXISTS, so running this
 * twice is safe. That is a "migration" in the simplest useful sense. Once you
 * outgrow it, look at tools like node-pg-migrate or Knex.
 *
 * WHY MULTIPLE STATEMENTS RUN IN ONE CALL:
 * node-postgres will happily run a multi-statement string, but ONLY when there
 * are no parameters. That is why we call `pool.query(sql)` with one argument
 * instead of `query(sql, [values])`.
 */
async function migrate(): Promise<void> {
  const schemaPath = join(__dirname, '..', '..', 'db', 'schema.sql');
  const sql = await readFile(schemaPath, 'utf8');

  console.log('[migrate] applying', schemaPath);

  await pool.query(sql);

  console.log('[migrate] done -- items table is ready');
}

migrate()
  .then(() => closePool())
  .then(() => {
    console.log('[migrate] connection closed');
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error('[migrate] failed:', error instanceof Error ? error.message : error);
    await closePool().catch(() => undefined);
    process.exit(1);
  });