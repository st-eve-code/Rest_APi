import { z } from 'zod';
import { ITEM_STATUSES } from '../../types/item';
import { ApiError } from '../../lib/ApiError';

/**
 * =============================================================================
 * VALIDATION
 * =============================================================================
 *
 * Never trust anything that comes in over the network. Every request body and
 * every query string is untrusted input until proven otherwise.
 *
 * zod gives us two big wins:
 *   1. The schema IS the runtime validator.
 *   2. Parse the result and TypeScript now knows the exact shape you get back,
 *      with no casting and no optional chaining everywhere.
 *
 * The rule: `schema.parse(data)` THROWS on bad input (handled by errorHandler),
 * while `schema.safeParse(data)` returns `{ success, data | error }`.
 *
 * ===========================================================================
 */

/**
 * Turns a ZodError into `[{ field, message }]` so the client can highlight the
 * exact input box that is wrong.
 *
 * Note we are writing human-friendly messages on purpose. zod's defaults are
 * accurate but cold ("Required", "String must contain at least 1 character(s)").
 */
export interface FieldError {
  field: string;
  message: string;
}

function fieldErrorsOf(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => {
    // issue.path is like ["body", "title"] -> "title"
    const path = issue.path.join('.');

    return {
      field: path === '' ? '_root' : path,
      message: issue.message,
    };
  });
}

/**
 * HOW TO USE A SCHEMA
 *
 *   const { createItemSchema } = require('./items.validator');
 *   const { data, error } = createItemSchema.safeParse(req.body);
 *   if (!error) console.log(data.title);  // typed as string, guaranteed
 *
 * Safe, but easy to forget the `if (!error)`. `validate()` below wraps that
 * boilerplate so route handlers stay two lines long.
 */

/** Shared rules. Reused so CREATE and PATCH enforce exactly the same limits. */
const titleField = z
  .string({ error: 'Title is required' })
  .trim()
  .min(1, 'Title is required')
  .max(200, 'Title must be 200 characters or fewer');

const descriptionField = z
  .string()
  .trim()
  .max(2000, 'Description must be 2000 characters or fewer')
  // `null` is allowed so a client can clear the field with PATCH.
  .nullish()
  .transform((value) => (value === '' ? null : value));

const statusField = z.enum(ITEM_STATUSES, {
  error: `Status must be one of: ${ITEM_STATUSES.join(', ')}`,
});

/**
 * POST /api/items
 * `title` is required; everything else has a sensible default.
 */
export const createItemSchema = z.object({
  title: titleField,
  description: descriptionField.default(null),
  status: statusField.default('todo'),
});

/**
 * PATCH /api/items/:id
 * Every field is `.optional()`, but if a field IS present it must be valid.
 * `z.object({...}).refine(o => Object.keys(o).length > 0)` stops someone
 * sending `{}` and thinking they updated something.
 */
export const updateItemSchema = z
  .object({
    title: titleField.optional(),
    description: descriptionField.optional(),
    status: statusField.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update (title, description or status)',
  });

/**
 * GET /api/items?status=done&title=fix&page=2&pageSize=10
 *
 * Query strings are ALWAYS strings, so "2" must become 2. `z.coerce.number()`
 * does that conversion for us -- and conveniently rejects "abc" too.
 */
export const listItemsQuerySchema = z.object({
  status: statusField.optional(),
  title: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive('Page must be 1 or greater').default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'Page size must be at least 1')
    .max(100, 'Page size must be 100 or fewer')
    .default(20),
});

export type CreateItemBody = z.infer<typeof createItemSchema>;
export type UpdateItemBody = z.infer<typeof updateItemSchema>;
export type ListItemsQueryInput = z.infer<typeof listItemsQuerySchema>;

/**
 * Runs a schema and either returns clean data or throws a ready-to-send
 * `ApiError`. Route handlers become:
 *
 *   const body = validate(createItemSchema, req.body);
 *   // <- if we got here, `body` is guaranteed valid
 *
 * Throwing (instead of returning an error object) means you cannot forget to
 * handle failure: the request simply never reaches the next line.
 */
export function validate<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);

  if (!result.success) {
    throw ApiError.badRequest('Validation failed', fieldErrorsOf(result.error));
  }

  return result.data;
}