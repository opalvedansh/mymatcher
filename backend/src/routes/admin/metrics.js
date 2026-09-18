const router = require('express').Router();
const { query } = require('express-validator');
const validate = require('../../middleware/validate');
const requireAdmin = require('../../middleware/requireAdmin');
const c = require('../../controllers/admin/metrics');
const { isoDate } = require('./_rules');
const { BREAKDOWNS } = require('../../services/adminMetrics');

router.get('/stats', requireAdmin('metrics:read'), c.getStats);

router.get(
  '/metrics/timeseries',
  requireAdmin('metrics:read'),
  [isoDate('from'), isoDate('to'), query('tz').optional().isString().isLength({ max: 64 })],
  validate,
  c.getTimeseries,
);

router.get(
  '/metrics/funnel',
  requireAdmin('metrics:read'),
  [isoDate('from'), isoDate('to'), query('role').optional().isIn(['brand', 'influencer'])],
  validate,
  c.getFunnel,
);

router.get(
  '/metrics/breakdown',
  requireAdmin('metrics:read'),
  [query('dimension').isIn(Object.keys(BREAKDOWNS))],
  validate,
  c.getBreakdown,
);

module.exports = router;
