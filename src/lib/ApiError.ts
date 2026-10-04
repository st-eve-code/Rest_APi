/**
 * ApiError = "an error we expected and want to show the client".
 *
 * Compare with a plain `throw new Error("oops")`:
 *   - `Error`      -> we have no idea what happened. Send 500, hide details.
 *   - `ApiError`   -> we know. Send its statusCode and message to the client.
 *
 * Rule of thumb: use ApiError for anything the CLIENT did wrong or asked for.
 * Let normal Errors bubble up for bugs (a typo, a null reference, etc).
 */
export class ApiError extends Error {
  /** The HTTP status code to send back, e.g. 404. */
  readonly statusCode: number;

  /** Optional machine-readable code the frontend can branch on, e.g. "NOT_FOUND". */
  readonly code: string;

  /** Optional extra context, e.g. which field failed validation. */
  readonly details?: unknown;

  constructor(
    statusCode: number,
    message: string,
    code = 'ERROR',
    details?: unknown,
  ) {
    // `super(message)` sets Error.message and makes `instanceof Error` work.
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    // Restores the prototype chain. Without this, `instanceof ApiError`
    // silently returns false after TypeScript downlevels the class to ES5.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** 400 - the request was malformed or failed validation. */
  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, message, 'BAD_REQUEST', details);
  }

  /** 404 - the thing you asked for does not exist. */
  static notFound(message = 'Resource not found') {
    return new ApiError(404, message, 'NOT_FOUND');
  }

  /** 409 - the request conflicts with the current state (e.g. duplicate). */
  static conflict(message: string, details?: unknown) {
    return new ApiError(409, message, 'CONFLICT', details);
  }

  /** 401 - we do not know who you are. Send them to log in. */
  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new ApiError(401, message, code);
  }

  /** 403 - we know who you are, but you are not allowed to do this. */
  static forbidden(message = 'You do not have permission to perform this action') {
    return new ApiError(403, message, 'FORBIDDEN');
  }

  /** 500 - we broke. The client gets a generic message, never the internals. */
  static internal(message = 'Internal server error') {
    return new ApiError(500, message, 'INTERNAL_ERROR');
  }
}