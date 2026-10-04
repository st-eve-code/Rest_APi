import { z } from 'zod';
import { USER_ROLES } from '../../types/user';
import { ApiError } from '../../lib/ApiError';
import type { FieldError, } from '../items/items.validator';

/**
 * Auth input validation. Same philosophy as items.validator.ts: untrusted until
 * proven otherwise, and the schema is both the runtime validator and the source
 * of the TypeScript type.
 */

/**
 * An email, trimmed and lower-cased.
 *
 * The regex is deliberately forgiving -- the authoritative check is whether the
 * address can receive mail, which a regex cannot know. Its job is to catch
 * obvious garbage before it costs a bcrypt round-trip and a database write.
 * The real guarantee is the unique index on users.email.
 */
const emailField = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .min(3, 'Email is required')
  .max(320, 'Email must be 320 characters or fewer')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address');

/**
 * Password rules are validated here, before hashing.
 *
 * The upper bound matters as much as the lower one: bcrypt truncates anything
 * past 72 bytes, so a 10,000-character password would give an attacker a much
 * cheaper brute force without the user knowing. Rejecting it is clearer than
 * silently ignoring most of it.
 */
const passwordField = z
  .string({ error: 'Password is required' })
  .min(12, 'Password must be at least 12 characters')
  .max(72, 'Password must be 72 characters or fewer');

/** POST /api/auth/register */
export const registerSchema = z.object({
  email: emailField,
  password: passwordField,
});

/**
 * POST /api/auth/login
 *
 * Note there are no rules beyond "must be a string": login must never tell a
 * caller whether their password was the wrong shape or the wrong value, or it
 * becomes a password oracle.
 */
export const loginSchema = z.object({
  email: emailField,
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required'),
});

/**
 * POST /api/auth/refresh
 *
 * The token may arrive in the body (native apps, Postman) or in an httpOnly
 * cookie (browsers, where JavaScript cannot read it). Accepting both is what
 * lets one API serve both kinds of client safely.
 */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required').optional(),
});

export type RegisterBody = z.infer<typeof registerSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
export type RefreshBody = z.infer<typeof refreshSchema>;

export { type FieldError };

/**
 * Re-runs a schema and throws a ready-to-send ApiError on failure.
 *
 * Same contract as `validate` in items.validator.ts, duplicated rather than
 * shared because each feature owning its validation file is what keeps features
 * independent -- and because the import in items.controller.ts reads better
 * coming from its own folder.
 */
export function validateAuth<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);

  if (!result.success) {
    const details: FieldError[] = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return { field: path === '' ? '_root' : path, message: issue.message };
    });

    throw ApiError.badRequest('Validation failed', details);
  }

  return result.data;
}