const router = require('express').Router();
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { getMessages, createUpload, clearChat, muteChat } = require('../controllers/chatController');

const matchIdRule = param('matchId').isUUID().withMessage('matchId must be a valid UUID');

const chatRules = [
  matchIdRule,
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('cursor').optional().isISO8601()
];

const uploadRules = [
  matchIdRule,
  body('kind').isIn(['image', 'video', 'audio', 'document']),
  body('mime').isString().isLength({ min: 3, max: 127 }),
  body('size').isInt({ min: 1 }).toInt(),
  body('name').optional({ values: 'null' }).isString().isLength({ max: 255 }),
];

const muteRules = [
  matchIdRule,
  body('duration').optional({ values: 'null' }).isIn(['8h', '1w', 'always']),
];

router.use(authenticate);

router.get('/:matchId/messages', chatRules, validate, getMessages);
router.post('/:matchId/uploads', uploadRules, validate, createUpload);
router.post('/:matchId/clear', [matchIdRule], validate, clearChat);
router.put('/:matchId/mute', muteRules, validate, muteChat);

module.exports = router;
