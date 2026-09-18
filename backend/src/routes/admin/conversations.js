const router = require('express').Router();
const { param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const requireAdmin = require('../../middleware/requireAdmin');
const c = require('../../controllers/admin/conversations');
const { adminMessageLimiter } = require('../../config/adminLimiters');
const { cursorQuery, limitQuery, isoDate } = require('./_rules');

router.get(
  '/',
  requireAdmin('matches:read'),
  [
    query('status').optional().isIn(['active', 'archived']),
    query('user_id').optional().isString().isLength({ max: 128 }),
    isoDate('from'), isoDate('to'), cursorQuery, limitQuery,
  ],
  validate,
  c.listMatches,
);

router.get('/:matchId', requireAdmin('matches:read'), [param('matchId').isUUID()], validate, c.getMatch);

// Shape of the conversation, never a word of it.
router.get(
  '/:matchId/timeline',
  requireAdmin('matches:read'),
  [param('matchId').isUUID(), cursorQuery, limitQuery],
  validate,
  c.getTimeline,
);

// The full decrypted thread. superadmin only (nothing else holds
// messages:read), a written reason enforced in the handler, 10 per hour, and
// an audit row written before anything is decrypted.
router.get(
  '/:matchId/messages',
  requireAdmin('messages:read'),
  adminMessageLimiter,
  [param('matchId').isUUID(), query('reason').isString().trim().isLength({ min: 10, max: 500 }), cursorQuery, limitQuery],
  validate,
  c.getMessages,
);

module.exports = router;
