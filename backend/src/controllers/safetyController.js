const db = require('../config/db');
const logger = require('../config/logger');
const realtime = require('../realtime');
const feedDeck = require('../services/feedDeck');
const { hardDeleteUser } = require('../services/userDeletion');

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
    const { rows: closed } = await client.query(
      `UPDATE matches SET status = 'archived'
       WHERE ((brand_id = $1 AND influencer_id = $2)
          OR (brand_id = $2 AND influencer_id = $1))
         AND status = 'active'
       RETURNING id`,
      [blockerId, blockedId]
    );
    await client.query('COMMIT');
    await Promise.all([
      realtime.closeMatches(closed.map((m) => m.id)),
      // The block hides each user from the other's deck.
      feedDeck.invalidate(blockerId),
      feedDeck.invalidate(blockedId),
    ]);
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
    // Decks dropped each other while blocked; rebuild so they can reappear.
    await Promise.all([feedDeck.invalidate(req.user.id), feedDeck.invalidate(req.params.userId)]);
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

// ─── DELETE /api/account ─────────────────────────────────────────
/**
 * Permanently deletes the caller's account (App Store Guideline 5.1.1(v)).
 * The pipeline lives in services/userDeletion so the admin hard delete runs
 * exactly the same steps in exactly the same order.
 */
async function deleteAccount(req, res, next) {
  try {
    await hardDeleteUser(req.user.id);
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
