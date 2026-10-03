import type { Request, Response } from 'express';
import { buildPaginationMeta, sendSuccess } from '../../lib/ApiResponse';
import { getPathParam } from '../../lib/http';
import {
  createItemSchema,
  listItemsQuerySchema,
  updateItemSchema,
  validate,
} from './items.validator';
import type { ItemService } from './items.service';
import type { ListItemsQuery } from '../../types/item';

/**
 * The controller's ONLY job is translation:
 *
 *   HTTP request  ->  plain objects  ->  HTTP response
 *
 * If you find yourself writing an `if` about your business rules in here, that
 * logic belongs in the service instead. Keeping the controller dumb is what makes
 * both layers easy to read on their own.
 */
export function createItemsController(service: ItemService) {
  // Returning the handlers as an object keeps each one named and reusable,
  // instead of three anonymous inline callbacks.
  return {
    /** GET /api/items?status=done&title=fix&page=1&pageSize=20 */
    async list(req: Request, res: Response): Promise<void> {
      // Validate + coerce the query string ("?page=2" -> page: 2).
      const query: ListItemsQuery = validate(listItemsQuerySchema, req.query);

      const { items, total } = await service.list(query);

      // 200 OK. `sendSuccess` builds the standard { success, data, meta } body.
      sendSuccess(
        res,
        200,
        items,
        buildPaginationMeta(total, query.page!, query.pageSize!),
      );
    },

    /** GET /api/items/:id */
    async getById(req: Request, res: Response): Promise<void> {
      const item = await service.getById(getPathParam(req, 'id'));
      sendSuccess(res, 200, item);
    },

    /** POST /api/items */
    async create(req: Request, res: Response): Promise<void> {
      const body = validate(createItemSchema, req.body);

      const item = await service.create(body);

      // 201 Created, plus a Location header pointing at the new resource.
      // This is the correct status code for "a new thing now exists".
      res.location(`/api/items/${item.id}`);
      sendSuccess(res, 201, item);
    },

    /** PATCH /api/items/:id */
    async update(req: Request, res: Response): Promise<void> {
      const body = validate(updateItemSchema, req.body);

      const item = await service.update(getPathParam(req, 'id'), body);
      sendSuccess(res, 200, item);
    },

    /** DELETE /api/items/:id */
    async remove(req: Request, res: Response): Promise<void> {
      await service.remove(getPathParam(req, 'id'));

      // 204 No Content: it worked, and there is deliberately no body.
      // Calling res.json() after a 204 makes Node throw, so just .send().
      res.status(204).send();
    },
  };
}

export type ItemsController = ReturnType<typeof createItemsController>;