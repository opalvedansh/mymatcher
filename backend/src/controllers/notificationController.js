const db = require('../config/db');
const { blockedBetween } = require('../utils/blocks');

// Items from people the user blocked (or who blocked them) are hidden.
const VISIBLE = `n.user_id = $1 AND (n.actor_id IS NULL OR NOT ${blockedBetween('$1', 'n.actor_id')})`;

/**
 * GET /api/notifications?limit=&before=
 * Newest first. `before` is the created_at of the last item already shown.
 * Likes never include who liked (that is a premium feature).
 */
async function listNotifications(req, res, next) {
  try {
    const limit = req.query.limit || 30;
    const params = [req.user.id, limit];
    let cursor = '';
    if (req.query.before) {
      params.push(req.query.before);
      cursor = 'AND n.created_at < $3';
    }

    const { rows } = await db.query(
      `SELECT
         n.id, n.type, n.match_id, n.title, n.body, n.read_at, n.created_at,
         CASE WHEN n.type = 'new_like' THEN NULL ELSE n.actor_id END AS actor_id,
         CASE WHEN n.type = 'new_like' THEN NULL ELSE COALESCE(ip.name, bp.name) END AS actor_name,
         CASE WHEN n.type = 'new_like' THEN NULL ELSE COALESCE(ip.avatar_url, bp.logo_url) END AS actor_avatar
       FROM notifications n
       LEFT JOIN influencer_profiles ip ON ip.user_id = n.actor_id
       LEFT JOIN brand_profiles bp ON bp.user_id = n.actor_id
       WHERE ${VISIBLE} ${cursor}
       ORDER BY n.created_at DESC
       LIMIT $2`,
      params
    );

    res.json({
      data: rows,
      next_before: rows.length === limit ? rows[rows.length - 1].created_at : null,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/notifications/unread-count
async function unreadCount(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count FROM notifications n WHERE ${VISIBLE} AND n.read_at IS NULL`,
      [req.user.id]
    );
    res.json({ count: rows[0]?.count ?? 0 });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/notifications/read
 * Body: { ids?: uuid[] } — marks those items read, or all of them when omitted.
 */
async function markRead(req, res, next) {
  try {
    const { ids } = req.body;
    const params = [req.user.id];
    let filter = '';
    if (Array.isArray(ids)) {
      if (ids.length === 0) return res.json({ updated: 0 });
      params.push(ids);
      filter = 'AND id = ANY($2::uuid[])';
    }
    const { rowCount } = await db.query(
      `UPDATE notifications SET read_at = now()
       WHERE user_id = $1 AND read_at IS NULL ${filter}`,
      params
    );
    res.json({ updated: rowCount ?? 0 });
  } catch (err) {
    next(err);
  }
}

module.exports = { listNotifications, unreadCount, markRead };
