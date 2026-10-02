const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { getCreatorReviews, reviewCreator, removeMyReview } = require('../controllers/reviewController');

const router = require('express').Router();

const creatorIdRules = [param('creatorId').isString().trim().notEmpty().isLength({ max: 128 })];
const reviewRules = [
  ...creatorIdRules,
  body('quote').isString().trim().isLength({ min: 10, max: 600 })
    .withMessage('Write between 10 and 600 characters'),
  body('reviewer_name').isString().trim().isLength({ min: 1, max: 80 })
    .withMessage('Add the name of the person writing the review'),
  body('reviewer_title').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 })
    .withMessage('Keep the role and company under 100 characters'),
];

router.use(authenticate, requireRole('brand', 'influencer'));

router.get   ('/:creatorId', creatorIdRules, validate, getCreatorReviews); // list, count, can I review
router.put   ('/:creatorId', reviewRules,    validate, reviewCreator);     // write or edit my review
router.delete('/:creatorId', creatorIdRules, validate, removeMyReview);    // take my review back

module.exports = router;
