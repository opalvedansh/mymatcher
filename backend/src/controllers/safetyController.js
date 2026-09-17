const db = require('../config/db');
const logger = require('../config/logger');
const redisClient = require('../config/redis');
const { getSupabaseAdmin } = require('../config/supabaseAdmin');
const { UPLOAD_BUCKET } = require('../utils/storage');
const { getIO } = require('../socket');

// ─── POST /api/blocks ────────────────────────────────────────────
async function blockUser(req, res, next) {
  const blockerId = req.user.id;
  const { user_id: blockedId } = req.body;

  if (blockedId === blockerId) {
    return res.status(400).json({ error: 'You cannot block yourself' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [blockerId, blockedId]
    );
    // Blocking ends the conversation for both sides; chat and stories only
    // follow active matches.
    await client.query(
      `UPDATE matches SET status = 'archived'
       WHERE (brand_id = $1 AND influencer_id = $2)
          OR (brand_id = $2 AND influencer_id = $1)`,
      [blockerId, blockedId]
    );
    await client.query('COMMIT');
    res.status(201).json({ blocked: true });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// ─── DELETE /api/blocks/:userId ──────────────────────────────────
async function unblockUser(req, res, next) {
  try {
    await db.query(
      'DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2',
      [req.user.id, req.params.userId]
    );
    // The archived match is not restored; they would need to match again.
    res.json({ blocked: false });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/blocks ─────────────────────────────────────────────
async function listBlocks(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT b.blocked_id AS user_id, b.created_at,
              COALESCE(bp.name, ip.name) AS name,
              COALESCE(bp.logo_url, ip.avatar_url) AS avatar
       FROM user_blocks b
       LEFT JOIN brand_profiles bp ON bp.user_id = b.blocked_id
       LEFT JOIN influencer_profiles ip ON ip.user_id = b.blocked_id
       WHERE b.blocker_id = $1
       ORDER BY b.created_at DESC
       LIMIT 500`,
      [req.user.id]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/reports ───────────────────────────────────────────
async function createReport(req, res, next) {
  try {
    const { target_type, target_id, reason, details } = req.body;
    const { rows: [report] } = await db.query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, details)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [req.user.id, target_type, target_id, reason, details || null]
    );
    logger.info({ reportId: report.id, target_type, reason }, 'Content reported');
    res.status(201).json({ id: report.id });
  } catch (err) {
    next(err);
  }
}

async function removeUserUploads(admin, userId) {
  const folder = `uploads/${userId}`;
  const bucket = admin.storage.from(UPLOAD_BUCKET);
  // Bounded: each pass removes up to 100 files; 1,000 passes is far beyond
  // any real account and stops a bad listing from looping forever.
  for (let pass = 0; pass < 1000; pass++) {
    const { data, error } = await bucket.list(folder, { limit: 100 });
    if (error) throw error;
    // Folder placeholders have no id and can't be removed.
    const files = data.filter((entry) => entry.id);
    if (!files.length) return;
    const { error: removeError } = await bucket.remove(files.map((f) => `${folder}/${f.name}`));
    if (removeError) throw removeError;
  }
}

// ─── DELETE /api/account ─────────────────────────────────────────
/**
 * Permanently deletes the caller's account (App Store Guideline 5.1.1(v)).
 * Order matters: files and rows go first, the auth identity last. If the
 * auth deletion fails the client can simply retry, because this route does
 * not require the users row to still exist.
 */
async function deleteAccount(req, res, next) {
  const userId = req.user.id;
  try {
    const admin = getSupabaseAdmin();

    await removeUserUploads(admin, userId);

    // Cascades to profiles, swipes, matches, messages, posts, likes,
    // stories, story views and blocks. Reports keep a NULL reporter.
    await db.query('DELETE FROM users WHERE id = $1', [userId]);

    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error && error.status !== 404) throw error;

    if (redisClient) {
      redisClient.del(`user:session:${userId}`).catch(() => {});
    }
    try {
      getIO().in(`user_${userId}`).disconnectSockets(true);
    } catch (err) {
      logger.warn({ err: err.message }, 'Could not disconnect deleted user sockets');
    }

    logger.warn({ userId }, 'Account deleted by user');
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
}

// ─── Admin: GET /api/admin/reports ───────────────────────────────
async function listReports(req, res, next) {
  try {
    const status = req.query.status || 'open';
    const { rows } = await db.query(
      `SELECT id, reporter_id, target_type, target_id, reason, details, status, created_at, reviewed_at, reviewed_by
       FROM reports
       WHERE status = $1 AND ($2::timestamptz IS NULL OR created_at < $2)
       ORDER BY created_at DESC
       LIMIT 100`,
      [status, req.query.cursor || null]
    );
    res.json({ data: rows, next_cursor: rows.length === 100 ? rows[rows.length - 1].created_at : null });
  } catch (err) {
    next(err);
  }
}

// ─── Admin: PUT /api/admin/reports/:reportId ─────────────────────
async function reviewReport(req, res, next) {
  try {
    const { rowCount } = await db.query(
      `UPDATE reports SET status = $1, reviewed_at = now(), reviewed_by = $2 WHERE id = $3`,
      [req.body.status, req.user.id, req.params.reportId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Report not found' });
    logger.info({ reportId: req.params.reportId, status: req.body.status, admin: req.user.id }, 'Report reviewed');
    res.json({ status: req.body.status });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  blockUser,
  unblockUser,
  listBlocks,
  createReport,
  deleteAccount,
  listReports,
  reviewReport,
};
