const router = require('express').Router();
const { body, param } = require('express-validator');
const validate = require('../../middleware/validate');
const requireAdmin = require('../../middleware/requireAdmin');
const c = require('../../controllers/admin/settings');
const { optionalReason } = require('./_rules');

router.get('/settings', requireAdmin('settings:read'), c.listSettings);
router.get('/settings/:key', requireAdmin('settings:read'), [param('key').isString().isLength({ max: 64 })], validate, c.getSetting);

router.put(
  '/settings/:key',
  requireAdmin('settings:write'),
  [param('key').isString().isLength({ max: 64 }), body('value').exists(), optionalReason],
  validate,
  c.updateSetting,
);

// Original paths, kept so the existing Expo admin screen keeps working. The
// per-key numeric validation now lives in services/adminSettings, which also
// enforces that the four weights total 100 - the old isNumeric() chain
// accepted negatives and any sum.
router.get('/algorithm', requireAdmin('settings:read'), c.getAlgorithmWeights);
router.put(
  '/algorithm',
  requireAdmin('settings:write'),
  [
    body('CATEGORY_OVERLAP').isNumeric(),
    body('BUDGET_FIT').isNumeric(),
    body('LOCATION_MATCH').isNumeric(),
    body('COMPLETENESS').isNumeric(),
  ],
  validate,
  c.updateAlgorithmWeights,
);

module.exports = router;
