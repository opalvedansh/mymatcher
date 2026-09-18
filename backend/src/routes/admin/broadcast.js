const router = require('express').Router();
const { body } = require('express-validator');
const validate = require('../../middleware/validate');
const requireAdmin = require('../../middleware/requireAdmin');
const c = require('../../controllers/admin/broadcast');
const { adminBroadcastLimiter } = require('../../config/adminLimiters');
const { cursorQuery, limitQuery } = require('./_rules');

const segmentRule = body('segment').optional().isObject();

router.post('/preview', requireAdmin('broadcast:send'), [segmentRule], validate, c.previewBroadcast);

router.post(
  '/',
  requireAdmin('broadcast:send'),
  adminBroadcastLimiter,
  [
    segmentRule,
    body('title').isString().trim().isLength({ min: 1, max: 120 }),
    body('body').isString().trim().isLength({ min: 1, max: 400 }),
    body('data').optional().isObject(),
    body('idempotency_key').optional().isString().isLength({ max: 128 }),
  ],
  validate,
  c.sendBroadcast,
);

router.get('/', requireAdmin('broadcast:send'), [cursorQuery, limitQuery], validate, c.listBroadcasts);

module.exports = router;
