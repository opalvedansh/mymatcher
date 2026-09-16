const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const storyController = require('../controllers/storyController');

const storyIdRules = [param('storyId').isUUID().withMessage('storyId must be a valid UUID')];

router.use(authenticate);

router.post('/', [body('media_url').isString().withMessage('media_url is required')], validate, storyController.uploadStory);
router.get('/feed', storyController.getFeedStories);
router.post('/:storyId/view', storyIdRules, validate, storyController.recordView);
router.get('/:storyId/viewers', storyIdRules, validate, storyController.getViewers);

module.exports = router;
