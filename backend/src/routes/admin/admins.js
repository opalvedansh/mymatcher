const router = require('express').Router();
const { body, query } = require('express-validator');
const validate = require('../../middleware/validate');
const requireAdmin = require('../../middleware/requireAdmin');
const c = require('../../controllers/admin/admins');
const { adminExportLimiter } = require('../../config/adminLimiters');
const { userIdParam, limitQuery, isoDate, requireReason, optionalReason } = require('./_rules');

const { ROLES } = requireAdmin;

// Any active admin: this is how the panel learns what it may render.
router.get('/me', c.getMe);

router.get(
  '/admins',
  requireAdmin('admins:read'),
  [query('include_revoked').optional().isBoolean()],
  validate,
  c.listAdmins,
);

router.post(
  '/admins',
  requireAdmin('admins:write'),
  [
    body('user_id').optional().isString().trim().isLength({ max: 128 }),
    body('email').optional().isEmail().normalizeEmail(),
    body('role').isIn(ROLES),
    body('note').optional().isString().trim().isLength({ max: 300 }),
  ],
  validate,
  c.grantAdmin,
);

router.patch(
  '/admins/:userId',
  requireAdmin('admins:write'),
  [
    userIdParam,
    body('role').optional().isIn(ROLES),
    body('note').optional().isString().trim().isLength({ max: 300 }),
    optionalReason,
  ],
  validate,
  c.updateAdmin,
);

router.delete(
  '/admins/:userId',
  requireAdmin('admins:write'),
  [userIdParam, requireReason(5)],
  validate,
  c.revokeAdmin,
);

const auditRules = [
  query('admin_id').optional().isString().isLength({ max: 128 }),
  query('action').optional().isString().isLength({ max: 64 }),
  query('target_type').optional().isString().isLength({ max: 32 }),
  query('target_id').optional().isString().isLength({ max: 128 }),
  query('status').optional().isInt({ min: 100, max: 599 }),
  query('search').optional().isString().isLength({ max: 200 }),
  query('cursor').optional().isInt(),
  isoDate('from'), isoDate('to'), limitQuery,
];

// Read and export only. There is deliberately no PUT or DELETE on this
// router: the audit log is append-only, and the DB role the API connects with
// should not hold DELETE on admin_audit_log either.
router.get('/audit', requireAdmin('audit:read'), auditRules, validate, c.listAudit);
router.get('/audit/export.csv', requireAdmin('audit:read'), adminExportLimiter, auditRules, validate, c.exportAudit);

module.exports = router;
