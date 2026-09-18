const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();
const { param, body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { cache } = require('../middleware/cacheMiddleware');
const { getMyProfile, updateMyProfile, getProfileById, getMyResponsiveness, requestVerification, verifyFace, syncInstagram, searchInstagram } = require('../controllers/profileController');
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
  body('budget_min').optional().isInt({ min: 0, max: 100000000 }).toInt(),
  body('budget_max').optional().isInt({ min: 0, max: 100000000 }).toInt(),
  body('campaign_days').optional().isInt({ min: 0, max: 365 }).toInt(),
  body('deliverable_reels').optional().isInt({ min: 0, max: 99 }).toInt(),
  body('deliverable_stories').optional().isInt({ min: 0, max: 99 }).toInt(),
  body('deliverable_posts').optional().isInt({ min: 0, max: 99 }).toInt(),
  // '' clears the mode; anything else has to be one the profile can render.
  body('payment_mode').optional().isIn(['', 'bank_transfer', 'upi', 'cheque', 'paypal']),
  body('payment_days').optional().isInt({ min: 0, max: 90 }).toInt(),
  body('price_min').optional().isNumeric().toInt(),
  body('price_max').optional().isNumeric().toInt(),
  body('lat').optional().isFloat().toFloat(),
  body('lng').optional().isFloat().toFloat(),
  body('categories').optional().isArray(),
  body('categories.*').optional().isString().trim(),
  body('campaign_types').optional().isArray({ max: 20 }),
  body('campaign_types.*').optional().isString().trim().isLength({ min: 1, max: 40 }),
  body('vibes').optional().isArray({ max: 20 }),
  body('vibes.*').optional().isString().trim().isLength({ min: 1, max: 40 }),
  body('reels').optional().isArray(),
];

const verificationRules = [
  body('business_name').isString().trim().isLength({ min: 2, max: 120 })
    .withMessage('Registered business name is required'),
  body('reg_number').isString().trim().isLength({ min: 4, max: 40 })
    .withMessage('A GST or company registration number is required'),
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
// Declared before '/:userId' so 'me' is not read as a user id.
router.get ('/me/responsiveness', getMyResponsiveness);
router.post('/me/verification',  verificationRules, validate, requestVerification);
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
