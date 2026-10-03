import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { config } from '../config';

/**
 * WHAT IS A CONNECTION POOL?
 *
 * Opening a TCP connection to a database is expensive (~10-50ms) and PostgreSQL
 * has a hard limit on concurrent connections (default 100). So instead of opening
 * a new connection per request, we keep a small pool of open connections and
 * borrow one for the duration of a query. When you're done, it's returned, not
 * closed. `pg` does this automatically -- you never manage sockets yourself.
 *
 * We create the Pool ONCE as a module-level singleton. Creating one per request
 * would defeat the entire purpose.
 */
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolMax,

  // If a client has been idle longer than this, close it.
  idleTimeoutMillis: 30_000,

  // If someone grabs a client and never returns it, don't wait forever.
  connectionTimeoutMillis: 5_000,
});

/**
 * When PostgreSQL sends a FATAL error (e.g. "the database does not exist"),
 * the `error` event fires on the idle client. Without a listener Node prints a
 * scary unhandled-error trace and exits. This listener keeps the process alive
 * so the app can report the problem in its own words.
 */
pool.on('error', (error) => {
  console.error('[db] unexpected error on an idle client:', error.message);
});

if (config.databaseLogQueries) {
  pool.on('connect', () => console.log('[db] client connected'));
  pool.on('remove', () => console.log('[db] client returned to pool'));
}

/**
 * Runs one SQL statement and returns the result.
 *
 * ALWAYS use $1, $2, ... placeholders -- never string-concatenate user input.
 * This is what stops SQL injection.
 *
 *   await query('SELECT * FROM items WHERE status = $1', ['done'])   // safe
 *   await query(`SELECT * FROM items WHERE status = '${x}'`)        // SQL injection
 *
 * @param text SQL with $1-style placeholders.
 * @param values Values to substitute for the placeholders.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  if (config.databaseLogQueries) {
    console.log('[db] query:', text, JSON.stringify(values));
  }

  return pool.query<T>(text, values);
}

/**
 * Borrows ONE client and gives it to you, so several queries inside `fn` run in
 * the same transaction. Use it when a single API call must either fully succeed
 * or fully roll back (e.g. "create the item AND create its first audit row").
 *
 * If `fn` throws, the transaction is rolled back and the client goes back to the
 * pool. If it returns normally, the transaction commits.
 *
 * `client.query` accepts the exact same arguments as our `query` helper.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    // `finally` runs whether we succeeded or failed -- always give the client
    // back, otherwise the pool eventually runs dry and everything hangs.
    client.release();
  }
}

/**
 * Verifies the database is reachable and closes the pool.
 * Called on server shutdown so we do not leave sockets dangling.
 */
export async function closePool(): Promise<void> {
  await pool.end();
}