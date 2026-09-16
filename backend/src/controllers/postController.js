const db = require('../config/db');
const { isOwnUploadUrl } = require('../utils/storage');

/**
 * POST /api/posts
 * Body: { image_url, caption }
 */
async function createPost(req, res, next) {
  try {
    const { image_url, caption } = req.body;
    const userId = req.user.id;

    if (!isOwnUploadUrl(image_url, userId)) {
      return res.status(400).json({ error: 'image_url must be an image you uploaded' });
    }

    const { rows: [post] } = await db.query(
      `INSERT INTO posts (user_id, image_url, caption)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, image_url, caption || null]
    );

    res.status(201).json({ post });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/posts/feed
 * Returns posts from all users, newest first
 */
async function getFeedPosts(req, res, next) {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;

    const { rows } = await db.query(
      `SELECT
         p.id, p.user_id, p.image_url, p.caption, p.likes_count, p.created_at,
         COALESCE(ip.name, bp.name) AS author_name,
         COALESCE(ip.avatar_url, bp.logo_url) AS author_avatar,
         COALESCE(ip.categories, bp.categories) AS author_categories,
         EXISTS(
           SELECT 1 FROM post_likes pl
           WHERE pl.post_id = p.id AND pl.user_id = $1
         ) AS liked_by_me
       FROM posts p
       LEFT JOIN influencer_profiles ip ON ip.user_id = p.user_id
       LEFT JOIN brand_profiles bp ON bp.user_id = p.user_id
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    res.json({ posts: rows });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/posts/my
 * Returns the current user's posts
 */
async function getMyPosts(req, res, next) {
  try {
    const userId = req.user.id;
    const { rows } = await db.query(
      `SELECT * FROM posts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [userId]
    );
    res.json({ posts: rows });
  } catch (err) {
    next(err);
  }
}

// Each statement changes likes_count only when its insert/delete actually
// changed a row, so concurrent or retried requests can't drift the count.
const LIKE_SQL = `
  WITH ins AS (
    INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  UPDATE posts SET likes_count = likes_count + (SELECT count(*) FROM ins)
  WHERE id = $1
  RETURNING likes_count`;

const UNLIKE_SQL = `
  WITH del AS (
    DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2
    RETURNING 1
  )
  UPDATE posts SET likes_count = GREATEST(likes_count - (SELECT count(*) FROM del), 0)
  WHERE id = $1
  RETURNING likes_count`;

/**
 * POST /api/posts/:postId/like
 * Body: { liked?: boolean }. With `liked` the call sets that state, so retries
 * are safe; without it the like is toggled (kept for older app builds).
 */
async function toggleLike(req, res, next) {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    let liked = req.body?.liked;
    if (typeof liked !== 'boolean') {
      const { rows } = await db.query(
        `SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2`,
        [postId, userId]
      );
      liked = rows.length === 0;
    }

    const { rows } = await db.query(liked ? LIKE_SQL : UNLIKE_SQL, [postId, userId]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({ liked, likes_count: rows[0].likes_count });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/posts/:postId
 * Delete a post (owner only)
 */
async function deletePost(req, res, next) {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    const { rowCount } = await db.query(
      `DELETE FROM posts WHERE id = $1 AND user_id = $2`,
      [postId, userId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Post not found or unauthorized' });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { createPost, getFeedPosts, getMyPosts, toggleLike, deletePost };
