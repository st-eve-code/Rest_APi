import type { Server } from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { closePool, pool } from './db/pool';

/**
 * THE PROCESS ENTRY POINT.
 *
 * Its job is narrow and important:
 *   1. make sure the database is reachable BEFORE accepting traffic,
 *   2. start listening,
 *   3. shut down cleanly on Ctrl+C / SIGTERM.
 *
 * Everything else belongs in app.ts so it can be tested.
 */
async function main(): Promise<void> {
  // Fail fast. A server that accepts requests it cannot answer is worse than one
  // that refuses to start, because the failure looks like a 500 to every user.
  // Skipped entirely in memory mode, where there is no database to reach.
  if (config.usesDatabase) {
    try {
      await pool.query('SELECT 1');
      console.log('[db] connected to PostgreSQL');
    } catch (error) {
      console.error(
        '[db] could not connect to PostgreSQL.\n' +
          '      Check that the server is running and DATABASE_URL in .env is correct.\n' +
          `      ${error instanceof Error ? error.message : String(error)}\n\n` +
          '      Tip: set DB_DRIVER=memory in .env to run without a database.',
      );
      process.exit(1);
    }
  }

  const app = createApp();

  const server: Server = app.listen(config.port, () => {
    console.log('');
    console.log('  ------------------------------------------------');
    console.log(`   Server ready at http://localhost:${config.port}`);
    console.log(`   Environment : ${config.nodeEnv}`);
    console.log(`   Storage     : ${config.usesDatabase ? 'PostgreSQL' : 'in-memory (resets on restart)'}`);
    console.log(`   Health check: http://localhost:${config.port}/health`);
    console.log('  ------------------------------------------------');
    console.log('');
  });

  /**
   * GRACEFUL SHUTDOWN.
   *
   * Without this, Ctrl+C kills the process mid-query and any in-flight request is
   * silently dropped -- and PostgreSQL keeps the connection until it times out.
   *
   * The pattern:
   *   1. stop accepting new connections,
   *   2. give in-flight requests a moment to finish,
   *   3. close the DB pool,
   *   4. exit -- falling back to a hard exit if cleanup takes too long.
   */
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    // Ignore a second Ctrl+C while we are already cleaning up.
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n[server] ${signal} received, shutting down...`);

    // Force-exit watchdog: if cleanup hangs, stop waiting after 10 seconds.
    const forceExit = setTimeout(() => {
      console.error('[server] shutdown took too long, forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    await new Promise<void>((resolve) => server.close(() => resolve()));

    try {
      await closePool();
      console.log('[db] connection pool closed');
    } catch (error) {
      console.error('[db] error while closing pool:', error);
    }

    clearTimeout(forceExit);
    console.log('[server] goodbye');
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // A crash we did not anticipate. Log it, then shut down cleanly instead of
  // leaving a half-dead process running.
  process.on('uncaughtException', (error) => {
    console.error('[server] uncaught exception:', error);
    void shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandled promise rejection:', reason);
    void shutdown('unhandledRejection');
  });
}

void main();