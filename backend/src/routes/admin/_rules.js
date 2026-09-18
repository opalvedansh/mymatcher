const { body, param, query } = require('express-validator');

/**
 * Shared validator chains for the admin routes.
 *
 * `reason` is enforced here rather than handler by handler, so a destructive
 * route cannot ship without one by omission — the audit log is only worth
 * having if the "why" column is populated.
 */
const requireReason = (min = 5) => body('reason')
  .isString().trim().isLength({ min, max: 500 })
  .withMessage(`reason must be ${min}-500 characters`);

const optionalReason = body('reason')
  .optional().isString().trim().isLength({ max: 500 });

const userIdParam = param('userId').isString().trim().notEmpty().isLength({ max: 128 });

const cursorQuery = query('cursor').optional().isString().isLength({ max: 512 });
const limitQuery = query('limit').optional().isInt({ min: 1, max: 200 }).toInt();
const isoDate = (field, where = query) => where(field).optional().isISO8601({ strict: true })
  .withMessage(`${field} must be YYYY-MM-DD`);

// Bulk sizes are enforced here, not by the 50kb body parser hitting a 413 by
// accident. 500 ids is roughly 22kb, so the old ceiling was the parser's.
const userIdsBody = [
  body('userIds').isArray({ min: 1, max: 500 })
    .withMessage('userIds must be an array of 1-500 ids'),
  body('userIds.*').isString().trim().notEmpty().isLength({ max: 128 }),
];

module.exports = {
  requireReason, optionalReason, userIdParam, cursorQuery, limitQuery, isoDate, userIdsBody,
};
