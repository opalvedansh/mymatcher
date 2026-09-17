const express = require('express');
const { body, param } = require('express-validator');
const { rateLimit } = require('express-rate-limit');
const validate = require('../middleware/validate');
const { authenticate, authenticateTokenOnly } = require('../middleware/auth');
const {
  blockUser,
  unblockUser,
  listBlocks,
  createReport,
  deleteAccount,
} = require('../controllers/safetyController');

const router = express.Router();

const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.user.id,
  message: { error: 'Too many reports — try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const userIdBody = [body('user_id').isString().notEmpty().isLength({ max: 128 })];
const userIdParam = [param('userId').isString().notEmpty().isLength({ max: 128 })];
const reportRules = [
  body('target_type').isIn(['user', 'post', 'story', 'message']),
  body('target_id').isString().notEmpty().isLength({ max: 128 }),
  body('reason').isIn(['spam', 'inappropriate', 'harassment', 'fake_profile', 'other']),
  body('details').optional({ values: 'null' }).isString().isLength({ max: 1000 }),
];

// Account deletion must work even if the users row is already gone (a retry
// after a partial failure), so it only needs a valid token.
router.delete('/account', authenticateTokenOnly, deleteAccount);

router.post('/blocks', authenticate, userIdBody, validate, blockUser);
router.get('/blocks', authenticate, listBlocks);
router.delete('/blocks/:userId', authenticate, userIdParam, validate, unblockUser);

router.post('/reports', authenticate, reportLimiter, reportRules, validate, createReport);

module.exports = router;
