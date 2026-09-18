const router = require('express').Router();
const { body, param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const requireAdmin = require('../../middleware/requireAdmin');
const c = require('../../controllers/admin/moderation');
const { adminMessageLimiter } = require('../../config/adminLimiters');
const { cursorQuery, limitQuery, requireReason } = require('./_rules');

const TARGET_TYPES = ['user', 'post', 'story', 'message'];
const REASONS = ['spam', 'inappropriate', 'harassment', 'fake_profile', 'other'];
const STATUSES = ['open', 'actioned', 'dismissed'];

router.post(
  '/bulk',
  requireAdmin('reports:write'),
  [
    body('report_ids').isArray({ min: 1, max: 100 }),
    body('report_ids.*').isUUID(),
    body('action').isIn(c.ACTIONS),
    requireReason(5),
  ],
  validate,
  c.bulkActOnReports,
);

router.get(
  '/',
  requireAdmin('reports:read'),
  [
    query('status').optional().isIn(STATUSES),
    query('target_type').optional().isIn(TARGET_TYPES),
    query('reason').optional().isIn(REASONS),
    query('reporter_id').optional().isString().isLength({ max: 128 }),
    query('target_id').optional().isString().isLength({ max: 128 }),
    cursorQuery, limitQuery,
  ],
  validate,
  c.listReports,
);

router.get('/:reportId', requireAdmin('reports:read'), [param('reportId').isUUID()], validate, c.getReport);

router.put(
  '/:reportId',
  requireAdmin('reports:write'),
  [param('reportId').isUUID(), body('status').isIn(STATUSES)],
  validate,
  c.reviewReport,
);

router.post(
  '/:reportId/action',
  requireAdmin('reports:write'),
  [param('reportId').isUUID(), body('action').isIn(c.ACTIONS), requireReason(5)],
  validate,
  c.actOnReport,
);

// The reported message plus five either side, decrypted. Rate-limited on the
// same bucket as the full-thread reader: both reveal private conversation.
router.get(
  '/:reportId/message-context',
  requireAdmin('reports:write'),
  adminMessageLimiter,
  [param('reportId').isUUID()],
  validate,
  c.getMessageContext,
);

module.exports = router;
