import { Router } from 'express';
import type { ItemsController } from './items.controller';

/**
 * =============================================================================
 * THE ROUTER
 * =============================================================================
 *
 * A router is a mini Express app. `router.get('/x', handler)` is the same idea as
 * `app.get('/x', handler)`, but the paths are relative -- so when we mount it with
 * `app.use('/api/items', itemsRouter)`, the route `GET /` becomes `GET /api/items`.
 *
 * Note there is no business logic and no database code here. A route file should
 * read like a table of contents: METHOD path  ->  which controller function.
 *
 * ===========================================================================
 */
export function createItemsRouter(controller: ItemsController): Router {
  const router = Router();

  router.get('/', controller.list);
  router.post('/', controller.create);

  // `/:id` is a URL PARAMETER. Whatever the client types there lands in
  // req.params.id. Because Express 5 uses path-to-regexp v8, optional params
  // are written as `/{id}`, NOT the old `/:id?` syntax.
  router.get('/:id', controller.getById);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);

  return router;
}