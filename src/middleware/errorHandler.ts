import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { sendError } from '../lib/ApiResponse';
import { ApiError } from '../lib/ApiError';

/**
 * PrismaClientKnownRequestError code 'P2002' = unique constraint violated.
 * We do not use Prisma, but keeping the check here means this handler works
 * if you swap the data layer later. Commented out on purpose -- see README.
 */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Converts a ZodError into a simple `{ fieldName: "message" }` map so the
 * frontend can show the message right next to the right input box.
 */
function formatZodIssues(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  for (const issue of error.issues) {
    // issue.path looks like ["body", "title"] -> we only want ["title"].
    const field = issue.path.filter((part) => part !== 'body').join('.') || '_root';
    fieldErrors[field] = issue.message;
  }

  return fieldErrors;
}

/**
 * THE ERROR HANDLER.
 *
 * This is the ONE place in the app that decides what JSON an error turns into.
 * Express sends control here when:
 *   1. you call `next(err)`,
 *   2. a route handler rejects (throws inside an `async` function),
 *   3. another error handler calls `next(err)`.
 *
 * Rules for error handlers:
 *   - MUST have exactly 4 parameters (err, req, res, next). Drop one and Express
 *     treats it as normal middleware. That is why `next` is unused below --
 *     it exists only to satisfy the signature, and we prefix it with `_`.
 *   - MUST be registered LAST, after notFoundHandler.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // 1. Our own "expected" errors: we know the status code and the message.
  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      console.error('[error]', err);
    }
    sendError(res, err.statusCode, err.message, err.code, err.details);
    return;
  }

  // 2. Validation errors thrown by our zod schemas.
  if (err instanceof ZodError) {
    sendError(
      res,
      422,
      'Validation failed',
      'VALIDATION_ERROR',
      formatZodIssues(err),
    );
    return;
  }

  // 3. Body-parser rejections: malformed JSON, payload too large, etc.
  if (err instanceof SyntaxError && 'body' in err) {
    sendError(res, 400, 'Malformed JSON in request body', 'BAD_REQUEST');
    return;
  }

  // 4. Raw errors from the `pg` driver (e.g. duplicate key, bad connection).
  if (err instanceof Error && 'code' in err && err.code === PG_UNIQUE_VIOLATION) {
    sendError(res, 409, 'A record with that value already exists', 'CONFLICT');
    return;
  }

  // 5. Anything else is a bug on OUR side. Log the real thing, tell the client
  //    nothing useful -- never leak stack traces or SQL to the outside world.
  console.error('[unhandled error]', err);
  sendError(res, 500, 'Internal server error', 'INTERNAL_ERROR');
}