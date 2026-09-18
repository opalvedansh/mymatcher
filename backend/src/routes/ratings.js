const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { getBrandRating, rateBrand, removeMyRating } = require('../controllers/ratingController');

const router = require('express').Router();

const brandIdRules = [param('brandId').isString().trim().notEmpty()];
const scoreRules = [
  ...brandIdRules,
  body('score').isInt({ min: 1, max: 5 }).toInt().withMessage('score must be 1 to 5'),
];

router.use(authenticate, requireRole('brand', 'influencer'));

router.get   ('/:brandId', brandIdRules, validate, getBrandRating);  // average, count, my score
router.put   ('/:brandId', scoreRules,   validate, rateBrand);       // rate, or change my rating
router.delete('/:brandId', brandIdRules, validate, removeMyRating);  // take my rating back

module.exports = router;
