const db = require('../../config/db');
const logger = require('../../config/logger');
const { getSupabaseAdmin } = require('../../config/supabaseAdmin');
const { invalidateCache } = require('../../middleware/cacheMiddleware');
const { UPLOAD_BUCKET, isOwnUploadUrl, storagePathFromUrl } = require('../../utils/storage');
const { encodeCursor, decodeCursor, clampLimit, boolParam } = require('../../utils/adminQuery');

/**
 * Best effort by design: a storage object left behind is much less bad than a
 * row that survived moderation because its file could not be removed.
 */
async function removeStorageObject(url, ownerId) {
  if (!isOwnUploadUrl(url, ownerId)) return false;
  try {
    const path = storagePathFromUrl(url, ownerId);
    if (!path) return false;
    const { error } = await getSupabaseAdmin().storage.from(UPLOAD_BUCKET).remove([path]);
    if (error) throw error;
    return true;
  } catch (err) {
    logger.warn({ err: err.message, url }, '[admin] storage object removal failed');
    return false;
  }
}

// ─── GET /api/admin/posts ────────────────────────────────────────
async function listPosts(req, res, next) {
  try {
    const limit = clampLimit(req.query.limit, 40, 100);
    const where = [];
    const params = [];
    const add = (v) => `$${params.push(v)}`;

    if (req.query.user_id) where.push(`p.user_id = ${add(req.query.user_id)}`);
    if (req.query.from) where.push(`p.created_at >= ${add(req.query.from)}::date`);
    if (req.query.to) where.push(`p.created_at < (${add(req.query.to)}::date + 1)`);

    const cursor = decodeCursor(req.query.cursor);
    if (cursor) {
      where.push(`(p.created_at, p.id::text) < ($${params.push(cursor.ts)}::timestamptz, $${params.push(cursor.id)})`);
    }

    const { rows } = await db.query(
      `SELECT p.id, p.user_id, p.image_url, p.caption, p.likes_count, p.created_at,
              COALESCE(bp.name, ip.name) AS author_name,
              (SELECT count(*) FROM reports r
                WHERE r.target_type = 'post' AND r.target_id = p.id::text)::int AS report_count
         FROM posts p
         LEFT JOIN brand_profiles      bp ON bp.user_id = p.user_id
         LEFT JOIN influencer_profiles ip ON ip.user_id = p.user_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $${params.push(limit + 1)}`,
      params
    );

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    res.json({
      data,
      next_cursor: hasMore ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id) : null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/admin/posts/:postId ─────────────────────────────
async function deletePost(req, res, next) {
  try {
    const { rows: [post] } = await db.query(
      'DELETE FROM posts WHERE id = $1::uuid RETURNING id, user_id, image_url, caption',
      [req.params.postId]
    );
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const storageRemoved = await removeStorageObject(post.image_url, post.user_id);
    req.audit
      .set({ action: 'post.delete', targetType: 'post', targetId: post.id, reason: req.body.reason })
      .add({ author: post.user_id, caption: post.caption, storage_removed: storageRemoved });

    res.json({ deleted: true, storage_removed: storageRemoved });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/stories ──────────────────────────────────────
async function listStories(req, res, next) {
  try {
    const limit = clampLimit(req.query.limit, 40, 100);
    const where = [];
    const params = [];
    const add = (v) => `$${params.push(v)}`;

    // Stories are never deleted, only filtered by expires_at, so the default
    // view is what is live and an operator opts in to the archive.
    if (!boolParam(req.query.include_expired)) where.push('s.expires_at > now()');
    if (req.query.user_id) where.push(`s.user_id = ${add(req.query.user_id)}`);

    const cursor = decodeCursor(req.query.cursor);
    if (cursor) {
      where.push(`(s.created_at, s.id::text) < ($${params.push(cursor.ts)}::timestamptz, $${params.push(cursor.id)})`);
    }

    const { rows } = await db.query(
      `SELECT s.id, s.user_id, s.media_url, s.created_at, s.expires_at,
              (s.expires_at < now()) AS expired,
              COALESCE(bp.name, ip.name) AS author_name,
              (SELECT count(*) FROM story_views v WHERE v.story_id = s.id)::int AS view_count,
              (SELECT count(*) FROM reports r
                WHERE r.target_type = 'story' AND r.target_id = s.id::text)::int AS report_count
         FROM stories s
         LEFT JOIN brand_profiles      bp ON bp.user_id = s.user_id
         LEFT JOIN influencer_profiles ip ON ip.user_id = s.user_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT $${params.push(limit + 1)}`,
      params
    );

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    res.json({
      data,
      next_cursor: hasMore ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id) : null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/admin/stories/:storyId ──────────────────────────
async function deleteStory(req, res, next) {
  try {
    const { rows: [story] } = await db.query(
      'DELETE FROM stories WHERE id = $1::uuid RETURNING id, user_id, media_url',
      [req.params.storyId]
    );
    if (!story) return res.status(404).json({ error: 'Story not found' });

    const storageRemoved = await removeStorageObject(story.media_url, story.user_id);
    req.audit
      .set({ action: 'story.delete', targetType: 'story', targetId: story.id, reason: req.body.reason })
      .add({ author: story.user_id, storage_removed: storageRemoved });

    res.json({ deleted: true, storage_removed: storageRemoved });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/users/:userId/photos ─────────────────────────
async function listUserPhotos(req, res, next) {
  try {
    const { userId } = req.params;
    const { rows: [user] } = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.role === 'brand') {
      const { rows: [p] } = await db.query(
        'SELECT photos, logo_url, cover_url FROM brand_profiles WHERE user_id = $1', [userId]
      );
      return res.json({ photos: p?.photos ?? [], logo_url: p?.logo_url ?? null, cover_url: p?.cover_url ?? null, reels: [] });
    }

    const { rows: [p] } = await db.query(
      'SELECT photos, avatar_url, cover_url, reels FROM influencer_profiles WHERE user_id = $1', [userId]
    );
    res.json({
      photos: p?.photos ?? [],
      avatar_url: p?.avatar_url ?? null,
      cover_url: p?.cover_url ?? null,
      reels: p?.reels ?? [],
    });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/admin/users/:userId/photos ──────────────────────
async function deleteUserPhoto(req, res, next) {
  try {
    const { userId } = req.params;
    const { url } = req.body;
    const { rows: [user] } = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.role) return res.status(422).json({ error: 'User has no profile' });

    const table = user.role === 'brand' ? 'brand_profiles' : 'influencer_profiles';
    // array_remove rather than a filtered rewrite: idempotent, so a retried
    // request cannot drop a different photo that shifted into the same index.
    const { rows: [updated] } = await db.query(
      `UPDATE ${table} SET photos = array_remove(photos, $2), updated_at = now()
        WHERE user_id = $1 RETURNING photos`,
      [userId, url]
    );
    if (!updated) return res.status(404).json({ error: 'Profile not found' });

    const storageRemoved = await removeStorageObject(url, userId);
    await invalidateCache(`cache:/api/profiles/${userId}`);

    req.audit
      .set({ action: 'user.photo_delete', targetType: 'user', targetId: userId, reason: req.body.reason })
      .add({ url, storage_removed: storageRemoved });

    res.json({ photos: updated.photos, storage_removed: storageRemoved });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listPosts, deletePost,
  listStories, deleteStory,
  listUserPhotos, deleteUserPhoto,
  removeStorageObject,
};
