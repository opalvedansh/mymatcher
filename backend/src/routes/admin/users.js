const router = require('express').Router();
const { body, query } = require('express-validator');
const validate = require('../../middleware/validate');
const requireAdmin = require('../../middleware/requireAdmin');
const c = require('../../controllers/admin/users');
const photos = require('../../controllers/admin/content');
const { adminExportLimiter } = require('../../config/adminLimiters');
const {
  userIdParam, cursorQuery, limitQuery, isoDate, requireReason, optionalReason, userIdsBody,
} = require('./_rules');
const { SORTS } = require('../../controllers/admin/users');

const listRules = [
  query('role').optional().isIn(['brand', 'influencer']),
  query('banned').optional().isBoolean(),
  query('verified').optional().isBoolean(),
  query('verification_status').optional().isIn(['none', 'pending', 'approved', 'rejected']),
  query('has_matches').optional().isBoolean(),
  query('has_push_token').optional().isBoolean(),
  query('include_deleted').optional().isBoolean(),
  query('search').optional().isString().trim().isLength({ min: 2, max: 200 }),
  query('sort').optional().isIn(Object.keys(SORTS)),
  query('dir').optional().isIn(['asc', 'desc']),
  query('offset').optional().isInt({ min: 0, max: 10000 }).toInt(),
  isoDate('created_from'), isoDate('created_to'), cursorQuery, limitQuery,
];

// Static paths first: /users/export.csv and /users/bulk-ban must not be caught
// by /users/:userId.
router.get('/export.csv', requireAdmin('users:export'), adminExportLimiter, listRules, validate, c.exportUsers);

router.post('/bulk-ban', requireAdmin('users:ban'), [...userIdsBody, requireReason(5)], validate, c.bulkBanUsers);
router.post('/bulk-unban', requireAdmin('users:ban'), [...userIdsBody, optionalReason], validate, c.bulkUnbanUsers);

router.get('/', requireAdmin('users:read'), listRules, validate, c.listUsers);

router.get('/:userId', requireAdmin('users:read'), [userIdParam], validate, c.getUser);
router.get('/:userId/onboarding', requireAdmin('users:read'), [userIdParam], validate, c.getUserOnboarding);
router.patch('/:userId', requireAdmin('users:write'), [userIdParam, requireReason(5)], validate, c.updateUser);

router.post('/:userId/ban', requireAdmin('users:ban'), [userIdParam, requireReason(5)], validate, c.banUser);
router.post('/:userId/unban', requireAdmin('users:ban'), [userIdParam, optionalReason], validate, c.unbanUser);
router.post('/:userId/restore', requireAdmin('users:delete'), [userIdParam, optionalReason], validate, c.restoreUser);

// Soft delete needs users:ban; the ?hard=true path additionally checks
// users:delete inside the handler, where the query string is available.
router.delete(
  '/:userId',
  requireAdmin('users:ban'),
  [userIdParam, query('hard').optional().isBoolean(), requireReason(10)],
  validate,
  c.deleteUser,
);

router.get('/:userId/photos', requireAdmin('content:read'), [userIdParam], validate, photos.listUserPhotos);
router.delete(
  '/:userId/photos',
  requireAdmin('content:delete'),
  [userIdParam, body('url').isString().isURL(), requireReason(5)],
  validate,
  photos.deleteUserPhoto,
);

module.exports = router;
