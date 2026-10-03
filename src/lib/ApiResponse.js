/**
 * Standard response helpers  --  PLAIN JAVASCRIPT (no types).
 *
 * This file is deliberately `.js`. TypeScript's `allowJs: true` lets any `.ts`
 * file import it just like a `.js` file would, so you can keep older/untyped
 * code and write new code in TypeScript, in the same project.
 *
 * The goal of this file is CONSISTENCY: every success looks the same and every
 * failure looks the same, so a frontend developer can rely on the shape.
 *
 * Success: { "success": true,  "data": ..., "meta": { ...optional... } }
 * Failure: { "success": false, "error": { "code": "...", "message": "...", "details": ... } }
 */

/**
 * Wrap data in the standard success envelope and send it.
 *
 * @param {object} res Express response object.
 * @param {number} status HTTP status code, e.g. 200 or 201.
 * @param {any} data The payload to send.
 * @param {object} [meta] Optional extra info (pagination, counts, ...).
 */
function sendSuccess(res, status, data, meta) {
  const body = { success: true, data };

  if (meta !== undefined) {
    body.meta = meta;
  }

  return res.status(status).json(body);
}

/**
 * Wrap an error in the standard failure envelope and send it.
 *
 * @param {object} res Express response object.
 * @param {number} status HTTP status code.
 * @param {string} message Human-readable message safe to show a user.
 * @param {string} [code] Machine-readable code, e.g. "VALIDATION_ERROR".
 * @param {any} [details] Optional extra info (e.g. per-field errors).
 */
function sendError(res, status, message, code = 'ERROR', details) {
  const error = { code, message };

  if (details !== undefined) {
    error.details = details;
  }

  return res.status(status).json({ success: false, error });
}

/**
 * Build a `meta` object for paginated list endpoints so the client always
 * knows how many records exist in total, not just on this page.
 *
 * @param {number} total Total number of matching records across all pages.
 * @param {number} page Current page (1-based).
 * @param {number} pageSize Records per page.
 */
function buildPaginationMeta(total, page, pageSize) {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;

  return {
    total,
    page,
    pageSize,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

module.exports = {
  sendSuccess,
  sendError,
  buildPaginationMeta,
};