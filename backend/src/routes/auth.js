const { body, query } = require('express-validator');
const validate  = require('../middleware/validate');
const { authenticate, authenticateTokenOnly } = require('../middleware/auth');
const { syncUser, me, getOnboardingData, updateOnboardingData, updatePushToken, saveWebPush, deleteWebPush } = require('../controllers/authController');

const { Expo } = require('expo-server-sdk');
const router = require('express').Router();

// Note: rate limiting for the whole /api/auth path is applied once,
// at mount time, in app.js (`app.use('/api/auth', authLimiter, authRoutes)`).

// ─── Validation chains ───────────────────────────────────────────
const syncRules = [
  body('role')
    .optional()
    .isIn(['brand', 'influencer']).withMessage('Role must be "brand" or "influencer"'),
];

// `token: null` clears the token (used on sign-out).
const pushTokenRules = [
  body('token')
    .custom((value) => value === null || (typeof value === 'string' && Expo.isExpoPushToken(value)))
    .withMessage('token must be an Expo push token or null'),
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
// Bootstrap route: creates the users row, so it cannot require one to exist.
router.post('/sync', authenticateTokenOnly, syncRules, validate, syncUser);

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

// Onboarding progress. The PUT upserts, so it runs before the row exists;
// the GET does not, and its 403 is handled client-side as "no progress yet".
router.get ('/onboarding', authenticate, getOnboardingData);
router.put ('/onboarding', authenticateTokenOnly, updateOnboardingData);

// Push token registration
router.put ('/push-token', authenticate, pushTokenRules, validate, updatePushToken);

// Browser push subscriptions (the web app); one per browser.
// The server POSTs to this URL, so only the browsers' push services are accepted.
const PUSH_SERVICE_HOST = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/;
const webPushEndpointRule = (check) => check('endpoint')
  .isString().isLength({ max: 1000 })
  .custom((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && PUSH_SERVICE_HOST.test(url.hostname);
  })
  .withMessage('endpoint must be a browser push service URL');
const webPushRules = [
  webPushEndpointRule(body),
  body('keys.p256dh').isString().isLength({ min: 1, max: 200 }),
  body('keys.auth').isString().isLength({ min: 1, max: 100 }),
];
router.put   ('/web-push', authenticate, webPushRules, validate, saveWebPush);
router.delete('/web-push', authenticate, [webPushEndpointRule(query)], validate, deleteWebPush);

module.exports = router;
