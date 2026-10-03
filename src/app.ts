import cors from 'cors';
import express, { type Express } from 'express';
import { config } from './config';
import { notFoundHandler } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { createItemsController } from './features/items/items.controller';
import { createItemsRouter } from './features/items/items.routes';
import { ItemService } from './features/items/items.service';
import { InMemoryItemRepository } from './features/items/inMemoryItemRepository';
import { PostgresItemRepository } from './features/items/postgresItemRepository';
import type { ItemRepository } from './features/items/itemRepository';

export interface AppDependencies {
  /** Injected so tests can pass the in-memory repository. */
  repository?: ItemRepository;
}

/**
 * Builds the Express application but does NOT start listening.
 *
 * WHY THIS IS SPLIT FROM server.ts
 *
 * A test needs an app it can call in-process -- no port, no `listen()`. supertest
 * does exactly that: it takes our app object and drives requests through the whole
 * stack. So `app.ts` = the app, `server.ts` = the thing that opens a port and
 * wires shutdown. This split is what makes automated testing of an API possible.
 *
 * This function is the COMPOSITION ROOT: the single place where concrete classes
 * are chosen and connected. Every other file just imports what it needs.
 */
export function createApp({ repository }: AppDependencies = {}): Express {
  const app = express();

  // --- 1. Global middleware ---------------------------------------------
  // Runs on every request, in the order registered. Order matters enormously:
  // if cors() ran after the routes, the browser would never see the headers.

  // Lets a browser on a different domain (e.g. React Native / web app) call us.
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin }));

  // Parses `req.body` from JSON. The `16kb` limit stops someone from uploading a
  // gigantic body and exhausting server memory.
  app.use(express.json({ limit: '16kb' }));

  // Logs method, path, status and duration. `next()` is essential: without it the
  // request stops here and never reaches your routes.
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} - ${ms.toFixed(1)}ms`);
    });

    next();
  });

  // --- 2. Routes --------------------------------------------------------

  // Liveness probe. Load balancers and orchestrators call this to check the
  // process is alive. Deliberately does NOT touch the database, so a database
  // outage does not make your service look dead and get restarted.
  app.get('/health', (_req, res) => {
    res.status(200).json({
      success: true,
      data: { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) },
    });
  });

  // If no repository was injected, pick one from configuration.
  // This `??` is the dependency-inversion switch: tests inject in-memory, and
  // DB_DRIVER decides what the running server injects. Neither can tell the
  // difference -- both satisfy the same ItemRepository interface.
  const itemRepository: ItemRepository =
    repository ??
    (config.usesDatabase
      ? new PostgresItemRepository()
      : new InMemoryItemRepository());

  if (!repository && !config.usesDatabase) {
    console.warn(
      '[storage] DB_DRIVER=memory -> using an in-memory array. ' +
        'Data is lost on restart. Set DB_DRIVER=postgres in .env for real storage.',
    );
  }

  const itemService = new ItemService(itemRepository);
  const itemsController = createItemsController(itemService);
  const itemsRouter = createItemsRouter(itemsController);

  // `app.use('/api/items', router)` = "for anything starting with /api/items,
  // hand it to this router".
  app.use('/api/items', itemsRouter);

  // --- 3. Error handling (MUST be last) ---------------------------------

  // Runs only when no route matched.
  app.use(notFoundHandler);

  // Runs only when something threw or called next(err).
  app.use(errorHandler);

  return app;
}