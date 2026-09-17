const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();
const { param, body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { cache } = require('../middleware/cacheMiddleware');
const { getMyProfile, updateMyProfile, getProfileById, verifyFace, syncInstagram, searchInstagram } = require('../controllers/profileController');
const { requireRole } = require('../middleware/auth');
const { isBlockedBetween } = require('../utils/blocks');
const { redisStore, limiterDefaults } = require('../config/rateLimitStore');

// Runs before the response cache, since cached profiles are shared by all viewers.
async function hideIfBlocked(req, res, next) {
  try {
    if (await isBlockedBetween(req.user.id, req.params.userId)) {
      return res.status(404).json({ error: 'User not found' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

const profileRules = [
  body('name').optional().isString().trim(),
  body('bio').optional().isString().trim(),
  body('budget_min').optional().isNumeric().toInt(),
  body('budget_max').optional().isNumeric().toInt(),
  body('price_min').optional().isNumeric().toInt(),
  body('price_max').optional().isNumeric().toInt(),
  body('lat').optional().isFloat().toFloat(),
  body('lng').optional().isFloat().toFloat(),
  body('categories').optional().isArray(),
  body('categories.*').optional().isString().trim(),
  body('reels').optional().isArray(),
];

const userIdRules = [
  param('userId').isString().notEmpty().withMessage('userId is required')
];

// Per-user limits on routes that call paid third-party APIs.
function perUserLimiter(name, limit, windowMs, message) {
  return rateLimit({
    store: redisStore(`rl:${name}:`),
    windowMs,
    limit,
    keyGenerator: (req) => req.user.id,
    message: { error: message },
    ...limiterDefaults,
  });
}
const instagramSearchLimiter = perUserLimiter('ig-search', 20, 60 * 1000, 'Too many searches — try again in a minute');
const faceVerifyLimiter = perUserLimiter('face', 5, 60 * 60 * 1000, 'Too many verification attempts — try again later');
// The 24h cooldown only covers re-syncing the same handle, so cap attempts too.
const instagramSyncLimiter = perUserLimiter('ig-sync', 5, 60 * 60 * 1000, 'Too many Instagram syncs — try again later');

// The selfie is sent as base64, so this route gets its own body limit; the
// global 50kb JSON parser skips it (see app.js).
const faceBodyParser = express.json({ limit: '6mb' });

// Every profile route requires authentication — including Instagram search,
// which runs a paid scraper per request.
router.use(authenticate);

router.get('/search-instagram', instagramSearchLimiter, searchInstagram);


/**
 * @swagger
 * /api/profiles:
 *   get:
 *     summary: Get my profile
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: My profile data
 */
router.get ('/me',          getMyProfile);
router.put ('/me',          profileRules, validate, updateMyProfile);
router.post('/verify-face', faceVerifyLimiter, faceBodyParser, verifyFace);
router.post('/sync-instagram', requireRole('influencer'), instagramSyncLimiter, syncInstagram);
/**
 * @swagger
 * /api/profiles/{userId}:
 *   get:
 *     summary: Get profile by user ID
 *     tags: [Profiles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Profile data
 */
router.get ('/:userId',   userIdRules, validate, hideIfBlocked, cache(300), getProfileById);

module.exports = router;
