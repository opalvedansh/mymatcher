const router = require('express').Router();
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const {
  createPost,
  getFeedPosts,
  getMyPosts,
  toggleLike,
  deletePost,
} = require('../controllers/postController');

const postIdRules = [param('postId').isUUID().withMessage('postId must be a valid UUID')];

const createRules = [
  body('image_url').isString().withMessage('image_url is required'),
  body('caption').optional({ values: 'null' }).isString().isLength({ max: 2200 }),
];

const feedRules = [
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  query('offset').optional().isInt({ min: 0, max: 10000 }).toInt(),
];

const likeRules = [...postIdRules, body('liked').optional().isBoolean({ strict: true })];

router.use(authenticate);

router.get('/feed', feedRules, validate, getFeedPosts);
router.get('/my', getMyPosts);
router.post('/', createRules, validate, createPost);
router.post('/:postId/like', likeRules, validate, toggleLike);
router.delete('/:postId', postIdRules, validate, deletePost);

module.exports = router;
