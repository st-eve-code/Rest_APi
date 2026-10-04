import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/authenticate';
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
 * SECURITY: every route below requires a valid access token.
 *
 * `router.use(authenticate)` is registered BEFORE the routes, so it guards all of
 * them at once -- and guards any route added later without anyone having to
 * remember. Nothing is public unless someone deliberately moves it above this
 * line, which makes "is this endpoint protected?" answerable by reading one line.
 *
 * DELETING IS ADMIN-ONLY. Deletion is the one irreversible operation in this API,
 * so it is the one that is restricted: any signed-in user can read, create and
 * update, but only an admin can destroy. Note the order of the two middleware --
 *
 *     authenticate, then requireRole('admin')
 *
 * `authenticate` has to come first, because `requireRole` reads the identity that
 * `authenticate` puts on the request. Reversed, it would read `undefined` and
 * reject everyone, including admins. Mounting it the other way round is the whole
 * bug this comment exists to prevent.
 *
 * Note the mount point: only `/api/items` is behind auth, not the whole app.
 * `/health` and `/api/auth/*` stay open, and that is intentional -- see app.ts.
 *
 * ===========================================================================
 */
export function createItemsRouter(controller: ItemsController): Router {
  const router = Router();

  router.use(authenticate);

  router.get('/', controller.list);
  router.post('/', controller.create);

  // `/:id` is a URL PARAMETER. Whatever the client types there lands in
  // req.params.id. Because Express 5 uses path-to-regexp v8, optional params
  // are written as `/{id}`, NOT the old `/:id?` syntax.
  router.get('/:id', controller.getById);
  router.patch('/:id', controller.update);

  // ADMIN ONLY -- see the note above. A signed-in non-admin gets 403 FORBIDDEN,
  // which is deliberately different from the 401 they would get with no token:
  // the identity was fine, the permission was not, so retrying with the same
  // token would fail the same way.
  router.delete('/:id', requireRole('admin'), controller.remove);

  return router;
}