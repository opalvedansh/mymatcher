const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
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
  ],
  validate,
  storyController.uploadStory
);
router.get('/feed', storyController.getFeedStories);
router.post('/:storyId/view', storyIdRules, validate, storyController.recordView);
router.get('/:storyId/viewers', storyIdRules, validate, storyController.getViewers);

module.exports = router;
