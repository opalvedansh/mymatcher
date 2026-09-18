const router = require('express').Router();
const { body, query } = require('express-validator');
const validate = require('../../middleware/validate');
const requireAdmin = require('../../middleware/requireAdmin');
const c = require('../../controllers/admin/verifications');
const { userIdParam, cursorQuery, limitQuery, optionalReason } = require('./_rules');

router.get(
  '/',
  requireAdmin('verifications:read'),
  [query('status').optional().isIn(['none', 'pending', 'approved', 'rejected']), cursorQuery, limitQuery],
  validate,
  c.listVerifications,
);

router.put(
  '/:userId',
  requireAdmin('verifications:write'),
  [
    userIdParam,
    // 'pending' is allowed so a decision can be put back in the queue, and
    // approved -> rejected is allowed so a wrongly granted badge is revocable.
    body('status').isIn(['approved', 'rejected', 'pending']),
    body('note').optional().isString().trim().isLength({ max: 300 }),
    optionalReason,
  ],
  validate,
  c.reviewVerification,
);

module.exports = router;
