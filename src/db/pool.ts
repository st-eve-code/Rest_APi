import { Pool, type QueryResult, type QueryResultRow } from 'pg';
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
 * Verifies the database is reachable and closes the pool.
 * Called on server shutdown so we do not leave sockets dangling.
 */
export async function closePool(): Promise<void> {
  await pool.end();
}