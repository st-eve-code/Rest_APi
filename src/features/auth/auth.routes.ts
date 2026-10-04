import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import type { AuthController } from './auth.controller';

/**
 * =============================================================================
 * THE AUTH ROUTER
 * =============================================================================
 *
 * Split into two groups, and the split is the whole security design:
 *
 *   PUBLIC  register / login / refresh / logout
 *           Must be reachable WITHOUT a valid access token -- that is their
 *           entire purpose.
 *
 *           `logout` is the interesting one. It looks like it should be private
 *           ("only a signed-in user can log out!") but think about what happens
 *           when the access token has expired: the client calls logout, gets a
 *           401, and is now unable to end its own session. Requiring a token to
 *           destroy a session is a trap. The endpoint is safe without one
 *           because it can only ever REVOKE something, never grant anything.
 *
 *   PRIVATE logout-all / me
 *           Protected with `authenticate`. `me` in particular must be private,
 *           or anyone could read any user's details by guessing an id.
 *
 * `router.use(authenticate)` is used rather than repeating the middleware on each
 * route, so a route added later is private by default. Opting OUT of auth has to
 * be a conscious, visible act; opting in should never be forgotten.
 *
 * ===========================================================================
 */
export function createAuthRouter(controller: AuthController): Router {
  const router = Router();

  // --- public ---
  router.post('/register', controller.register);
  router.post('/login', controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);

  // --- private ---
  router.use(authenticate);
  router.post('/logout-all', controller.logoutAll);
  router.get('/me', controller.me);

  return router;
}