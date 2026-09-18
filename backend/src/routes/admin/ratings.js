const router = require('express').Router();
const { param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const requireAdmin = require('../../middleware/requireAdmin');
const c = require('../../controllers/admin/ratings');
const { cursorQuery, limitQuery, isoDate, requireReason } = require('./_rules');

router.get('/suspicious', requireAdmin('ratings:read'), c.listSuspiciousRatings);

router.get(
  '/',
  requireAdmin('ratings:read'),
  [
    query('brand_id').optional().isString().isLength({ max: 128 }),
    query('influencer_id').optional().isString().isLength({ max: 128 }),
    query('score').optional().isInt({ min: 1, max: 5 }),
    isoDate('from'), isoDate('to'), cursorQuery, limitQuery,
  ],
  validate,
  c.listRatings,
);

router.delete(
  '/:ratingId',
  requireAdmin('ratings:delete'),
  [param('ratingId').isUUID(), requireReason(5)],
  validate,
  c.deleteRating,
);

module.exports = router;
