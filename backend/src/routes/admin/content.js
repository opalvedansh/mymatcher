const router = require('express').Router();
const { param, query } = require('express-validator');
const validate = require('../../middleware/validate');
const requireAdmin = require('../../middleware/requireAdmin');
const c = require('../../controllers/admin/content');
const { cursorQuery, limitQuery, isoDate, requireReason } = require('./_rules');

router.get(
  '/posts',
  requireAdmin('content:read'),
  [query('user_id').optional().isString().isLength({ max: 128 }), isoDate('from'), isoDate('to'), cursorQuery, limitQuery],
  validate,
  c.listPosts,
);

router.delete(
  '/posts/:postId',
  requireAdmin('content:delete'),
  [param('postId').isUUID(), requireReason(5)],
  validate,
  c.deletePost,
);

router.get(
  '/stories',
  requireAdmin('content:read'),
  [
    query('user_id').optional().isString().isLength({ max: 128 }),
    query('include_expired').optional().isBoolean(),
    cursorQuery, limitQuery,
  ],
  validate,
  c.listStories,
);

router.delete(
  '/stories/:storyId',
  requireAdmin('content:delete'),
  [param('storyId').isUUID(), requireReason(5)],
  validate,
  c.deleteStory,
);

module.exports = router;
