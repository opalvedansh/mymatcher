const router = require('express').Router();
const { param, body, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const {
  getStats,
  listUsers,
  banUser,
  unbanUser,
  deleteUser,
  bulkBanUsers,
  bulkUnbanUsers,
  getAlgorithmWeights,
  updateAlgorithmWeights
} = require('../controllers/adminController');
const { listReports, reviewReport } = require('../controllers/safetyController');

const userIdRules = [
  param('userId').isString().notEmpty().withMessage('userId is required')
];

const algorithmRules = [
  body('CATEGORY_OVERLAP').isNumeric(),
  body('BUDGET_FIT').isNumeric(),
  body('LOCATION_MATCH').isNumeric(),
  body('COMPLETENESS').isNumeric()
];

// All admin routes require authentication + admin check
router.use(authenticate, requireAdmin);

router.get ('/stats',                       getStats);
router.get ('/users',                       listUsers);
router.post('/users/bulk-ban',              bulkBanUsers);
router.post('/users/bulk-unban',            bulkUnbanUsers);
router.post('/users/:userId/ban',           userIdRules, validate, banUser);
router.post('/users/:userId/unban',         userIdRules, validate, unbanUser);
router.delete('/users/:userId',             userIdRules, validate, deleteUser);

router.get ('/algorithm',                   getAlgorithmWeights);
router.put ('/algorithm',                   algorithmRules, validate, updateAlgorithmWeights);
router.get ('/reports',                     [query('status').optional().isIn(['open', 'actioned', 'dismissed']), query('cursor').optional().isISO8601()], validate, listReports);
router.put ('/reports/:reportId',           [param('reportId').isUUID(), body('status').isIn(['open', 'actioned', 'dismissed'])], validate, reviewReport);

module.exports = router;
