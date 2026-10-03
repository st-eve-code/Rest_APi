/**
 * 404 handler  --  PLAIN JAVASCRIPT (no types).
 *
 * WHY THIS FILE EXISTS:
 * Express matches routes in order. If nothing matched, control falls through to
 * middleware registered with `app.use(...)`. Putting this AFTER all real routes
 * means it only ever runs when a request matched no route at all.
 *
 * It must be registered with FOUR arguments (`err, req, res, next`) to be treated
 * as an error handler by Express -- but we ignore `err` and use it purely as a
 * "run me last" marker.
 *
 * @param {object} req Express request object.
 * @param {object} res Express response object.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`,
    },
  });
}

module.exports = { notFoundHandler };