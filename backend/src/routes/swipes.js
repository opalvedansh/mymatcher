const { body } = require('express-validator');
const validate  = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { recordSwipe, undoLastSwipe, getMySwipes, getLikesReceived } = require('../controllers/swipeController');

const router = require('express').Router();

router.use(authenticate, requireRole('brand', 'influencer'));

const swipeRules = [
  body('swiped_id')
    .isString().notEmpty().withMessage('swiped_id must be a non-empty string'),
  body('direction')
    .isIn(['like', 'reject', 'super_like']).withMessage('direction must be "like", "reject", or "super_like"'),
];

router.post  ('/',     swipeRules, validate, recordSwipe);
router.delete('/last',             undoLastSwipe);
router.get   ('/',                 getMySwipes);
router.get   ('/received',         getLikesReceived);

module.exports = router;
