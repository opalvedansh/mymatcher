const logger = require('../config/logger');

/**
 * Central error handler — must be the LAST middleware registered in app.js.
 * Express identifies it by its 4-parameter signature (err, req, res, next).
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // Structured error logging via Pino
  logger.error({
    err,
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id || 'anonymous',
  }, err.message || 'Unhandled error');

  // Postgres unique-violation (duplicate email, duplicate swipe, etc.)
  // err.detail echoes the conflicting row values, so it stays in the logs only.
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Duplicate entry' });
  }

  // Postgres foreign-key violation
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced resource does not exist' });
  }

  // Postgres invalid input syntax (e.g. a malformed UUID)
  if (err.code === '22P02') {
    return res.status(400).json({ error: 'Invalid input' });
  }

  const status = err.statusCode || err.status || 500;
  // Client errors raised deliberately (body-parser 413, etc.) carry a safe
  // message; 5xx messages can contain SQL or internals and are never sent.
  const message = status < 500 && err.expose !== false
    ? (err.message || 'Bad request')
    : 'Internal server error';

  res.status(status).json({ error: message });
}

module.exports = errorHandler;
