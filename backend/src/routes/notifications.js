const { body, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { listNotifications, unreadCount, markRead } = require('../controllers/notificationController');

const router = require('express').Router();

const listRules = [
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  query('before').optional().isISO8601(),
];

const readRules = [
  body('ids').optional().isArray({ max: 100 }).withMessage('ids must be a list of up to 100 ids'),
  body('ids.*').isUUID().withMessage('Each id must be a valid UUID'),
];

router.use(authenticate, requireRole('brand', 'influencer'));

router.get ('/',             listRules, validate, listNotifications); // my inbox, newest first
router.get ('/unread-count', unreadCount);                            // badge count for the bell
router.post('/read',         readRules, validate, markRead);          // mark some or all read

module.exports = router;
