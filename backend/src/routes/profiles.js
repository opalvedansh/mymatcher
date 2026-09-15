const router = require('express').Router();
const { param, body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { cache } = require('../middleware/cacheMiddleware');
const { getMyProfile, updateMyProfile, getProfileById, verifyFace, syncInstagram, searchInstagram } = require('../controllers/profileController');
const { requireRole } = require('../middleware/auth');

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

// ─── Public route: no auth needed ───
router.get('/search-instagram', searchInstagram);

// All other profile routes require authentication
router.use(authenticate);


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
router.post('/verify-face', verifyFace);
router.post('/sync-instagram', requireRole('influencer'), syncInstagram);
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
router.get ('/:userId',   userIdRules, validate, cache(300), getProfileById);

module.exports = router;
