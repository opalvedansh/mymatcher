const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const storyController = require('../controllers/storyController');

const storyIdRules = [param('storyId').isUUID().withMessage('storyId must be a valid UUID')];

// A story's layout carries the author's drawing, which can outgrow the global
// 50kb JSON limit; app.js leaves this one path to parse its own body.
const storyBodyParser = express.json({ limit: '256kb' });

router.use(authenticate);

router.post(
  '/',
  storyBodyParser,
  [
    body('media_url').optional({ values: 'null' }).isString().withMessage('media_url must be a string'),
    body('layout').optional({ values: 'null' }).isObject().withMessage('layout must be an object'),
    body('media_type').optional().isIn(['image', 'video']).withMessage('media_type must be image or video'),
    body('audience').optional().isIn(['all', 'close_friends']).withMessage('audience must be all or close_friends'),
    body('duration_ms').optional({ values: 'null' }).isInt({ min: 0, max: 600000 }).toInt(),
  ],
  validate,
  storyController.uploadStory
);
router.get('/feed', storyController.getFeedStories);
router.get('/audience', storyController.getAudience);
router.put(
  '/close-friends',
  [
    body('ids').isArray({ max: 1000 }).withMessage('ids must be a list of at most 1000'),
    body('ids.*').isString().isLength({ min: 1, max: 128 }),
  ],
  validate,
  storyController.setCloseFriends
);
router.get('/music', [query('q').optional().isString().isLength({ max: 100 })], validate, storyController.searchMusic);
router.post('/:storyId/view', storyIdRules, validate, storyController.recordView);
router.get('/:storyId/viewers', storyIdRules, validate, storyController.getViewers);

module.exports = router;
