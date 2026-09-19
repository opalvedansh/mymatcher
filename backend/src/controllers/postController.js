const db = require('../config/db');
const { isOwnUploadUrl } = require('../utils/storage');
const { blockedBetween } = require('../utils/blocks');
const postRanking = require('../services/postRanking');
const { sendPostLikeNotification } = require('../services/notificationService');

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
 * GET /api/posts/feed?limit=&cursor=
 * Interest-ranked feed. See services/postRanking.js for the scoring.
 *
 * Builds before the ranked feed paginated with `offset`, which duplicates and
 * skips posts as new ones arrive. Those builds are still in the wild, so a
 * request carrying a non-zero `offset` and no `cursor` gets the old
 * chronological query and keeps working exactly as it did.
 */
async function getFeedPosts(req, res, next) {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const legacyOffset = parseInt(req.query.offset, 10) || 0;

    if (!req.query.cursor && legacyOffset > 0) {
      return res.json({ posts: await legacyChronologicalFeed(userId, limit, legacyOffset) });
    }

    const { posts, next_cursor } = await postRanking.getPage(
      userId,
      req.query.cursor || null,
      limit
    );
    res.json({ posts, next_cursor });
  } catch (err) {
    next(err);
  }
}

async function legacyChronologicalFeed(userId, limit, offset) {
  const { rows } = await db.query(
    `SELECT
       p.id, p.user_id, p.image_url, p.caption,
       p.likes_count, p.comments_count, p.shares_count, p.created_at,
       COALESCE(ip.name, bp.name) AS author_name,
       COALESCE(ip.avatar_url, bp.logo_url) AS author_avatar,
       COALESCE(ip.categories, bp.categories) AS author_categories,
       COALESCE(ip.verified, bp.verified, false) AS author_verified,
       EXISTS(
         SELECT 1 FROM post_likes pl
         WHERE pl.post_id = p.id AND pl.user_id = $1
       ) AS liked_by_me
     FROM posts p
     LEFT JOIN influencer_profiles ip ON ip.user_id = p.user_id
     LEFT JOIN brand_profiles bp ON bp.user_id = p.user_id
     WHERE NOT ${blockedBetween('$1', 'p.user_id')}
     ORDER BY p.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows;
}

/**
 * GET /api/posts/:postId
 * One post, for the screen a shared link opens.
 */
async function getPost(req, res, next) {
  try {
    const userId = req.user.id;
    const { postId } = req.params;

    const { rows } = await db.query(
      `SELECT
         p.id, p.user_id, p.image_url, p.caption,
         p.likes_count, p.comments_count, p.shares_count, p.created_at,
         COALESCE(ip.name, bp.name) AS author_name,
         COALESCE(ip.avatar_url, bp.logo_url) AS author_avatar,
         COALESCE(ip.categories, bp.categories) AS author_categories,
         COALESCE(ip.verified, bp.verified, false) AS author_verified,
         EXISTS(
           SELECT 1 FROM post_likes pl
           WHERE pl.post_id = p.id AND pl.user_id = $1
         ) AS liked_by_me
       FROM posts p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN influencer_profiles ip ON ip.user_id = p.user_id
       LEFT JOIN brand_profiles bp ON bp.user_id = p.user_id
       WHERE p.id = $2
         AND u.banned = false
         AND u.deleted_at IS NULL
         AND NOT ${blockedBetween('$1', 'p.user_id')}`,
      [userId, postId]
    );

    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    res.json({ post: rows[0] });
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

/**
 * POST /api/posts/:postId/like
 * Body: { liked?: boolean }. With `liked` the call sets that state, so retries
 * are safe; without it the like is toggled (kept for older app builds).
 *
 * likes_count moved onto a trigger in migration 029 (an app-level counter
 * silently drifts when a cascade deletes like rows), so these are plain writes
 * and the count is read back after.
 */
async function toggleLike(req, res, next) {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    const { rows: postRows } = await db.query(
      `SELECT user_id FROM posts WHERE id = $1`,
      [postId]
    );
    if (!postRows.length) return res.status(404).json({ error: 'Post not found' });

    let liked = req.body?.liked;
    if (typeof liked !== 'boolean') {
      const { rows } = await db.query(
        `SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2`,
        [postId, userId]
      );
      liked = rows.length === 0;
    }

    let changed;
    if (liked) {
      const { rowCount } = await db.query(
        `INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [postId, userId]
      );
      changed = rowCount > 0;
    } else {
      const { rowCount } = await db.query(
        `DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2`,
        [postId, userId]
      );
      changed = rowCount > 0;
    }

    const { rows } = await db.query(`SELECT likes_count FROM posts WHERE id = $1`, [postId]);

    // Only a like that actually landed notifies, so a retried request or a
    // double tap cannot notify the author twice.
    if (liked && changed) {
      sendPostLikeNotification({
        postId,
        postAuthorId: postRows[0].user_id,
        likerId: userId,
      }).catch(() => {});
    }

    res.json({ liked, likes_count: rows[0]?.likes_count ?? 0 });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/posts/:postId/share
 * Body: { channel?: 'app'|'link'|'web' }
 *
 * Records that a share happened. This is the strongest engagement signal the
 * ranker has, and it is what makes shares_count on the card real rather than
 * decorative. The app calls this only once the OS share sheet reports a
 * completed share, so a sheet someone backs out of does not inflate the count.
 */
async function recordShare(req, res, next) {
  try {
    const { postId } = req.params;
    const userId = req.user.id;
    const channel = req.body?.channel || 'app';

    const { rows } = await db.query(
      `INSERT INTO post_shares (post_id, user_id, channel)
       SELECT $1, $2, $3
       WHERE EXISTS (SELECT 1 FROM posts WHERE id = $1)
       RETURNING id`,
      [postId, userId, channel]
    );
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });

    const { rows: counts } = await db.query(
      `SELECT shares_count FROM posts WHERE id = $1`,
      [postId]
    );
    res.status(201).json({ shares_count: counts[0]?.shares_count ?? 0 });
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

module.exports = {
  createPost,
  getFeedPosts,
  getPost,
  getMyPosts,
  toggleLike,
  recordShare,
  deletePost,
};
