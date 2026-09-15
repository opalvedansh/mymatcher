const { body } = require('express-validator');
const validate  = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { syncUser, me, getOnboardingData, updateOnboardingData, updatePushToken } = require('../controllers/authController');

const router = require('express').Router();

// Note: rate limiting for the whole /api/auth path is applied once,
// at mount time, in app.js (`app.use('/api/auth', authLimiter, authRoutes)`).

// ─── Validation chains ───────────────────────────────────────────
const syncRules = [
  body('role')
    .optional()
    .isIn(['brand', 'influencer']).withMessage('Role must be "brand" or "influencer"'),
];

const pushTokenRules = [
  body('token').isString().notEmpty().withMessage('Expo push token is required'),
];

// ─── Routes ──────────────────────────────────────────────────────
/**
 * @swagger
 * /api/auth/sync:
 *   post:
 *     summary: Synchronize Firebase user with PostgreSQL
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [brand, influencer]
 *     responses:
 *       200:
 *         description: User synchronized successfully
 */
router.post('/sync', authenticate, syncRules, validate, syncUser);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current authenticated user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user record
 */
router.get ('/me',   authenticate, me);

// Onboarding progress
router.get ('/onboarding', authenticate, getOnboardingData);
router.put ('/onboarding', authenticate, updateOnboardingData);

// Push token registration
router.put ('/push-token', authenticate, pushTokenRules, validate, updatePushToken);

module.exports = router;
