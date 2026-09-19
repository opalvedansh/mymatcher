const db = require('../config/db');
const { blockedBetween } = require('../utils/blocks');
const { sendCommentNotification } = require('../services/notificationService');

// Comments from people the viewer blocked (or who blocked them) are hidden,
// the same rule the notification inbox uses.
const VISIBLE = (viewer, author) => `NOT ${blockedBetween(viewer, author)}`;

const AUTHOR_JOIN = `
  LEFT JOIN influencer_profiles ip ON ip.user_id = c.user_id
  LEFT JOIN brand_profiles     bp ON bp.user_id = c.user_id`;

const AUTHOR_COLS = `
  COALESCE(ip.name, bp.name) AS author_name,
  COALESCE(ip.avatar_url, bp.logo_url) AS author_avatar,
  COALESCE(ip.verified, bp.verified, false) AS author_verified`;

/** Post row plus whether the viewer may see it at all. Null when it is gone. */
async function loadVisiblePost(postId, viewerId) {
  const { rows } = await db.query(
    `SELECT p.id, p.user_id
       FROM posts p
       JOIN users u ON u.id = p.user_id
      WHERE p.id = $2
        AND u.banned = false
        AND u.deleted_at IS NULL
        AND NOT ${blockedBetween('$1', 'p.user_id')}`,
    [viewerId, postId]
  );
  return rows[0] || null;
}

/**
 * GET /api/posts/:postId/comments?limit=&before=
 * Top-level comments, newest first, each with a preview of its first replies.
 */
async function listComments(req, res, next) {
  try {
    const viewerId = req.user.id;
    const { postId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    const post = await loadVisiblePost(postId, viewerId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const params = [viewerId, postId, limit];
    let cursor = '';
    if (req.query.before) {
      params.push(req.query.before);
      cursor = 'AND c.created_at < $4';
    }

    const { rows } = await db.query(
      `SELECT
         c.id, c.post_id, c.user_id, c.parent_id, c.body,
         c.likes_count, c.replies_count, c.edited_at, c.created_at,
         ${AUTHOR_COLS},
         EXISTS (
           SELECT 1 FROM comment_likes cl
           WHERE cl.comment_id = c.id AND cl.user_id = $1
         ) AS liked_by_me
       FROM post_comments c
       ${AUTHOR_JOIN}
       WHERE c.post_id = $2
         AND c.parent_id IS NULL
         AND ${VISIBLE('$1', 'c.user_id')}
         ${cursor}
       ORDER BY c.created_at DESC
       LIMIT $3`,
      params
    );

    res.json({
      comments: rows,
      next_before: rows.length === limit ? rows[rows.length - 1].created_at : null,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/posts/:postId/comments/:commentId/replies?limit=&after=
 * Replies oldest first, so a thread reads as a conversation.
 */
async function listReplies(req, res, next) {
  try {
    const viewerId = req.user.id;
    const { postId, commentId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    const post = await loadVisiblePost(postId, viewerId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const params = [viewerId, commentId, limit, postId];
    let cursor = '';
    if (req.query.after) {
      params.push(req.query.after);
      cursor = 'AND c.created_at > $5';
    }

    const { rows } = await db.query(
      `SELECT
         c.id, c.post_id, c.user_id, c.parent_id, c.body,
         c.likes_count, c.replies_count, c.edited_at, c.created_at,
         ${AUTHOR_COLS},
         EXISTS (
           SELECT 1 FROM comment_likes cl
           WHERE cl.comment_id = c.id AND cl.user_id = $1
         ) AS liked_by_me
       FROM post_comments c
       ${AUTHOR_JOIN}
       WHERE c.parent_id = $2
         AND c.post_id = $4
         AND ${VISIBLE('$1', 'c.user_id')}
         ${cursor}
       ORDER BY c.created_at ASC
       LIMIT $3`,
      params
    );

    res.json({
      replies: rows,
      next_after: rows.length === limit ? rows[rows.length - 1].created_at : null,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/posts/:postId/comments
 * Body: { body, parent_id? }
 */
async function createComment(req, res, next) {
  try {
    const viewerId = req.user.id;
    const { postId } = req.params;
    const body = req.body.body.trim();
    const parentId = req.body.parent_id || null;

    const post = await loadVisiblePost(postId, viewerId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    // Who gets told. Resolved before the insert so a reply to a comment that
    // was just deleted fails as a 404 rather than a silent orphan.
    let recipientId = post.user_id;
    if (parentId) {
      const { rows } = await db.query(
        `SELECT user_id, post_id, parent_id FROM post_comments WHERE id = $1`,
        [parentId]
      );
      const parent = rows[0];
      if (!parent || parent.post_id !== postId) {
        return res.status(404).json({ error: 'Parent comment not found' });
      }
      if (parent.parent_id) {
        return res.status(400).json({ error: 'Replies are limited to one level' });
      }
      recipientId = parent.user_id;
    }

    const { rows: [comment] } = await db.query(
      `INSERT INTO post_comments (post_id, user_id, parent_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, post_id, user_id, parent_id, body,
                 likes_count, replies_count, edited_at, created_at`,
      [postId, viewerId, parentId, body]
    );

    // Echo the author fields back so the client can render the new comment
    // without refetching the list.
    const { rows: [author] } = await db.query(
      `SELECT
         COALESCE(ip.name, bp.name) AS author_name,
         COALESCE(ip.avatar_url, bp.logo_url) AS author_avatar,
         COALESCE(ip.verified, bp.verified, false) AS author_verified
       FROM (SELECT $1::text AS uid) v
       LEFT JOIN influencer_profiles ip ON ip.user_id = v.uid
       LEFT JOIN brand_profiles     bp ON bp.user_id = v.uid`,
      [viewerId]
    );

    // Fire and forget: the comment is already saved, and a push failure must
    // not turn a successful write into a 500.
    sendCommentNotification({
      postId,
      commentId: comment.id,
      commentBody: body,
      actorId: viewerId,
      recipientId,
      isReply: Boolean(parentId),
    }).catch(() => {});

    res.status(201).json({
      comment: { ...comment, ...author, liked_by_me: false },
    });
  } catch (err) {
    // The one-level and same-post rules are enforced by a trigger too, so a
    // race that slips past the checks above surfaces as a 400, not a 500.
    if (err.code === '23514') {
      return res.status(400).json({ error: 'Invalid reply target' });
    }
    next(err);
  }
}

/**
 * DELETE /api/posts/:postId/comments/:commentId
 * The comment's author or the post's author may delete. Replies cascade.
 */
async function deleteComment(req, res, next) {
  try {
    const viewerId = req.user.id;
    const { postId, commentId } = req.params;

    const { rowCount } = await db.query(
      `DELETE FROM post_comments c
        USING posts p
        WHERE c.id = $1
          AND c.post_id = $2
          AND p.id = c.post_id
          AND (c.user_id = $3 OR p.user_id = $3)`,
      [commentId, postId, viewerId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Comment not found or unauthorized' });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/posts/:postId/comments/:commentId/like
 * Body: { liked?: boolean }. Explicit state makes retries safe; the toggle
 * fallback matches the post like endpoint.
 */
async function toggleCommentLike(req, res, next) {
  try {
    const viewerId = req.user.id;
    const { postId, commentId } = req.params;

    const { rows: exists } = await db.query(
      `SELECT 1 FROM post_comments WHERE id = $1 AND post_id = $2`,
      [commentId, postId]
    );
    if (!exists.length) return res.status(404).json({ error: 'Comment not found' });

    let liked = req.body?.liked;
    if (typeof liked !== 'boolean') {
      const { rows } = await db.query(
        `SELECT 1 FROM comment_likes WHERE comment_id = $1 AND user_id = $2`,
        [commentId, viewerId]
      );
      liked = rows.length === 0;
    }

    // The counter is kept by a trigger, so these are plain writes and the count
    // is read back afterwards.
    if (liked) {
      await db.query(
        `INSERT INTO comment_likes (comment_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [commentId, viewerId]
      );
    } else {
      await db.query(
        `DELETE FROM comment_likes WHERE comment_id = $1 AND user_id = $2`,
        [commentId, viewerId]
      );
    }

    const { rows } = await db.query(
      `SELECT likes_count FROM post_comments WHERE id = $1`,
      [commentId]
    );
    res.json({ liked, likes_count: rows[0]?.likes_count ?? 0 });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listComments,
  listReplies,
  createComment,
  deleteComment,
  toggleCommentLike,
};
