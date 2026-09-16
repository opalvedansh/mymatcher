const { query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { getFeed } = require('../controllers/feedController');

const router = require('express').Router();

const feedRules = [
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('cursor_score').optional().isFloat(),
  query('cursor_id').optional().isString().isLength({ max: 128 }),
];

// Scoring depends on the user's side of the marketplace.
router.use(authenticate, requireRole('brand', 'influencer'));
router.get('/', feedRules, validate, getFeed);

module.exports = router;
