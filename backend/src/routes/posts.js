const router = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { redisStore, limiterDefaults } = require('../config/rateLimitStore');
const {
  createPost,
  getFeedPosts,
  getPost,
  getMyPosts,
  toggleLike,
  recordShare,
  deletePost,
} = require('../controllers/postController');
const {
  listComments,
  listReplies,
  createComment,
  deleteComment,
  toggleCommentLike,
} = require('../controllers/commentController');

const postIdRules = [param('postId').isUUID().withMessage('postId must be a valid UUID')];
const commentIdRules = [param('commentId').isUUID().withMessage('commentId must be a valid UUID')];

const createRules = [
  body('image_url').isString().withMessage('image_url is required'),
  body('caption').optional({ values: 'null' }).isString().isLength({ max: 2200 }),
];

const feedRules = [
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  query('offset').optional().isInt({ min: 0, max: 10000 }).toInt(),
  query('cursor').optional().isString().isLength({ max: 256 }),
];

const likeRules = [...postIdRules, body('liked').optional().isBoolean({ strict: true })];

const shareRules = [
  ...postIdRules,
  body('channel').optional().isIn(['app', 'link', 'web']),
];

const listCommentRules = [
  ...postIdRules,
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  query('before').optional().isISO8601(),
];

const listReplyRules = [
  ...postIdRules,
  ...commentIdRules,
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  query('after').optional().isISO8601(),
];

const createCommentRules = [
  ...postIdRules,
  body('body').isString().trim().isLength({ min: 1, max: 2200 })
    .withMessage('Comment must be between 1 and 2200 characters'),
  body('parent_id').optional({ values: 'null' }).isUUID(),
];

// Comments are the cheapest way to spam a feed, so they are capped per user
// well below the global limiter.
const commentLimiter = rateLimit({
  store: redisStore('rl:comment:'),
  windowMs: 10 * 60 * 1000,
  limit: 60,
  keyGenerator: (req) => req.user.id,
  message: { error: 'You are commenting too fast — try again in a few minutes' },
  ...limiterDefaults,
});

router.use(authenticate);

router.get('/feed', feedRules, validate, getFeedPosts);
router.get('/my', getMyPosts);
router.post('/', createRules, validate, createPost);

// Comments. Registered before '/:postId' so the literal segments win.
router.get('/:postId/comments', listCommentRules, validate, listComments);
router.get('/:postId/comments/:commentId/replies', listReplyRules, validate, listReplies);
router.post('/:postId/comments', commentLimiter, createCommentRules, validate, createComment);
router.delete('/:postId/comments/:commentId', [...postIdRules, ...commentIdRules], validate, deleteComment);
router.post(
  '/:postId/comments/:commentId/like',
  [...postIdRules, ...commentIdRules, body('liked').optional().isBoolean({ strict: true })],
  validate,
  toggleCommentLike
);

router.post('/:postId/like', likeRules, validate, toggleLike);
router.post('/:postId/share', shareRules, validate, recordShare);
router.delete('/:postId', postIdRules, validate, deletePost);
router.get('/:postId', postIdRules, validate, getPost);

module.exports = router;
