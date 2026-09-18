const router = require('express').Router();
const { authenticateTokenOnly } = require('../../middleware/auth');
const requireAdmin = require('../../middleware/requireAdmin');
const adminAudit = require('../../middleware/adminAudit');
const { adminLimiter, adminWriteLimiter, adminAuthFailLimiter } = require('../../config/adminLimiters');

/**
 * /api/admin
 *
 * authenticateTokenOnly rather than authenticate: an admin is a Supabase auth
 * identity and need not have a `users` row. `authenticate` 403s
 * `profile_incomplete` without one, which would force every staff member
 * through the consumer onboarding flow just to sign in to the panel.
 * Verified safe — no admin handler reads req.user.role or req.user.banned,
 * and authenticateTokenOnly still blocks a banned uid.
 */
router.use(
  adminAuthFailLimiter,   // counts 403s per IP, before anything reveals whether you are an admin
  authenticateTokenOnly,
  adminLimiter,
  requireAdmin(),
  adminAudit,
);

// Writes get their own, much tighter bucket.
router.use((req, res, next) => (req.method === 'GET' ? next() : adminWriteLimiter(req, res, next)));

router.use('/', require('./metrics'));
router.use('/', require('./admins'));
router.use('/users', require('./users'));
router.use('/reports', require('./moderation'));
router.use('/', require('./content'));
router.use('/verifications', require('./verifications'));
router.use('/ratings', require('./ratings'));
router.use('/matches', require('./conversations'));
router.use('/', require('./settings'));
router.use('/broadcast', require('./broadcast'));
router.use('/', require('./system'));

module.exports = router;
