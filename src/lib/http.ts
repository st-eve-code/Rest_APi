import type { Request } from 'express';
import { ApiError } from './ApiError';

/**
 * Reads a single URL parameter as a string.
 *
 * WHY THIS HELPER EXISTS
 *
 * In Express 5 a route parameter is typed `string | string[]`, because patterns
 * like `/files/:name.:ext` can match several groups. TypeScript therefore cannot
 * prove `req.params.id` is a string, and neither can you.
 *
 * If a parameter ever arrives as an array, the URL was malformed -- so returning
 * a clean 400 beats letting an array leak into a SQL query.
 *
 *   const id = getPathParam(req, 'id');
 */
export function getPathParam(req: Request, name: string): string {
  const value = req.params[name];

  if (typeof value !== 'string' || value.length === 0) {
    throw ApiError.badRequest(`Missing or invalid URL parameter "${name}"`);
  }

  return value;
}