import type { ErrorBody, FieldError, PaginationMeta, SuccessBody } from '../types';

/**
 * The HTTP layer. Every network call in the app goes through `request()`.
 *
 * Its job is to turn "a fetch that may or may not have worked" into one of two
 * things: a clean typed value, or a thrown `ApiRequestError` carrying the
 * server's own error envelope. Components therefore never deal with
 * `res.ok`, status codes, or untyped JSON.
 */

/** Base path. Relative on purpose: Vite proxies it to Express in dev. */
const BASE_URL = '/api';

/**
 * A failed request, already parsed into something displayable.
 *
 * Why a custom class instead of `new Error(msg)`: the UI needs to branch on
 * `status` (show a "not found" state), read `code` (differentiate a validation
 * failure from a conflict), and highlight specific inputs via `fieldErrors`.
 * A plain Error carries only a string, which loses all of that.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldError[];

  constructor(status: number, code: string, message: string, fieldErrors: FieldError[] = []) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    Object.setPrototypeOf(this, ApiRequestError.prototype);
  }

  /** True when the server rejected the input, so we should point at the form. */
  get isValidationError(): boolean {
    return this.status === 400 || this.status === 422;
  }

  /** The message for a given input name, or undefined when it is valid. */
  errorFor(field: string): string | undefined {
    return this.fieldErrors.find((e) => e.field === field)?.message;
  }
}

/**
 * Normalises `error.details` into `[{ field, message }]`.
 *
 * The API uses `details` for two different shapes (see FieldError in types.ts),
 * and it may be absent entirely. Being liberal here means the form can render
 * field errors without caring which validator produced them.
 */
function toFieldErrors(details: unknown): FieldError[] {
  if (Array.isArray(details)) {
    return details.flatMap((entry) => {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        'field' in entry &&
        'message' in entry &&
        typeof entry.message === 'string'
      ) {
        const { field, message } = entry as { field: unknown; message: string };
        return [{ field: String(field), message }];
      }
      return [];
    });
  }

  if (typeof details === 'object' && details !== null) {
    return Object.entries(details as Record<string, unknown>).flatMap(([field, message]) =>
      typeof message === 'string' ? [{ field, message }] : [],
    );
  }

  return [];
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Caller-supplied AbortSignal, so a stale request cannot overwrite fresh data. */
  signal?: AbortSignal;
}

/**
 * Performs one request and returns the whole success envelope.
 *
 * Note what is NOT here: no try/catch around `fetch` itself for error shapes.
 * `fetch` only rejects on a network-level failure, which we translate into a
 * friendly message; anything that reached the server comes back as the standard
 * failure envelope and is parsed below.
 */
async function send<T>(
  path: string,
  { method = 'GET', body, signal }: RequestOptions = {},
): Promise<SuccessBody<T> | undefined> {
  const url = `${BASE_URL}${path}`;

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    // The server is not running, or the request was aborted. `AbortError` is a
    // normal part of racing requests, so it is rethrown untouched and handled by
    // the caller; anything else means we never reached the API.
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause;
    }

    throw new ApiRequestError(
      0,
      'NETWORK_ERROR',
      'Could not reach the API. Is the server running on port 3000? (npm run dev:api)',
    );
  }

  // 204 No Content is the documented response for DELETE, and res.json() on a
  // 204 would throw. There is genuinely no envelope to parse.
  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();

  // The server always speaks JSON. If we got HTML instead, the request never
  // reached Express (e.g. the Vite proxy is down), so say that rather than
  // showing a confusing "Unexpected token < in JSON".
  let parsed: unknown;
  try {
    parsed = text === '' ? undefined : JSON.parse(text);
  } catch {
    throw new ApiRequestError(
      response.status,
      'BAD_RESPONSE',
      `Expected JSON from the API but got ${response.headers.get('content-type') ?? 'an unknown type'}.`,
    );
  }

  if (!response.ok) {
    const envelope = parsed as ErrorBody | undefined;
    const error = envelope?.success === false ? envelope.error : undefined;

    throw new ApiRequestError(
      response.status,
      error?.code ?? 'ERROR',
      error?.message ?? `Request failed with status ${response.status}`,
      toFieldErrors(error?.details),
    );
  }

  // Hand back the whole envelope: `meta` (pagination) lives here, not in `data`.
  return parsed as SuccessBody<T>;
}

/** Performs a request and returns just the unwrapped `data`. */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const envelope = await send<T>(path, options);
  return envelope?.data as T;
}

/**
 * Performs a request and returns `data` together with `meta`.
 *
 * List endpoints need both: the rows AND the pagination block, because
 * `total`/`totalPages` cannot be derived from the rows on the current page.
 */
export async function requestWithMeta<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta?: PaginationMeta }> {
  const envelope = await send<T>(path, options);
  return { data: envelope?.data as T, meta: envelope?.meta };
}