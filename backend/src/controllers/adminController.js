const db = require('../config/db');
const { invalidateWeights } = require('../services/feedRanking');
const { endSessions } = require('../utils/sessions');
const logger = require('../config/logger');

// ─── GET /api/admin/stats ────────────────────────────────────────
async function getStats(req, res, next) {
  try {
    const { rows: [counts] } = await db.query(`
      SELECT
        (SELECT COALESCE(reltuples::bigint, 0) FROM pg_class WHERE relname = 'users') AS total_users,
        (SELECT COUNT(*) FROM users WHERE role = 'brand')                             AS total_brands,
        (SELECT COUNT(*) FROM users WHERE role = 'influencer')                        AS total_influencers,
        (SELECT COUNT(*) FROM users WHERE banned = true)                              AS banned_users,
        (SELECT COALESCE(reltuples::bigint, 0) FROM pg_class WHERE relname = 'matches') AS active_matches,
        (SELECT COALESCE(reltuples::bigint, 0) FROM pg_class WHERE relname = 'swipes')  AS total_swipes,
        (SELECT COALESCE(reltuples::bigint, 0) FROM pg_class WHERE relname = 'messages') AS total_messages
    `);

    res.json(counts);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/users ────────────────────────────────────────
async function listUsers(req, res, next) {
  try {
    const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const role   = req.query.role || null;
    const search = req.query.search || null;

    let query = `
      SELECT u.id, u.email, u.role, u.banned, u.created_at,
        COALESCE(bp.name, ip.name) AS name
      FROM users u
      LEFT JOIN brand_profiles bp ON bp.user_id = u.id
      LEFT JOIN influencer_profiles ip ON ip.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (role) {
      params.push(role);
      query += ` AND u.role = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (u.email ILIKE $${params.length} OR bp.name ILIKE $${params.length} OR ip.name ILIKE $${params.length})`;
    }

    params.push(limit);
    query += ` ORDER BY u.created_at DESC LIMIT $${params.length}`;

    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const { rows } = await db.query(query, params);
    res.json({ data: rows, limit, offset });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/admin/users/:userId/ban ───────────────────────────
async function banUser(req, res, next) {
  try {
    const { userId } = req.params;
    const { rowCount } = await db.query(
      'UPDATE users SET banned = true, updated_at = now() WHERE id = $1',
      [userId]
    );

    if (!rowCount) {
      return res.status(404).json({ error: 'User not found' });
    }

    await endSessions([userId]);
    logger.info({ userId, admin: req.user.id }, 'User banned by admin');
    res.json({ message: 'User banned successfully' });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/admin/users/:userId/unban ─────────────────────────
async function unbanUser(req, res, next) {
  try {
    const { userId } = req.params;
    const { rowCount } = await db.query(
      'UPDATE users SET banned = false, updated_at = now() WHERE id = $1',
      [userId]
    );

    if (!rowCount) {
      return res.status(404).json({ error: 'User not found' });
    }

    await endSessions([userId], { disconnect: false });
    logger.info({ userId, admin: req.user.id }, 'User unbanned by admin');
    res.json({ message: 'User unbanned successfully' });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/admin/users/:userId ─────────────────────────────
async function deleteUser(req, res, next) {
  try {
    const { userId } = req.params;

    // CASCADE handles profile, swipes, matches, messages cleanup
    const { rowCount } = await db.query(
      'DELETE FROM users WHERE id = $1',
      [userId]
    );

    if (!rowCount) {
      return res.status(404).json({ error: 'User not found' });
    }

    await endSessions([userId]);
    logger.warn({ userId, admin: req.user.id }, 'User hard-deleted by admin');
    res.json({ message: 'User and all related data deleted' });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/admin/users/bulk-ban ─────────────────────────────
/**
 * Body: { userIds: string[] }
 *
 * Bans up to 500 users per call in a single batched UPDATE … WHERE id = ANY($1).
 * Chunks very large arrays to avoid oversized parameter lists.
 */
async function bulkBanUsers(req, res, next) {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || !userIds.length) {
      return res.status(400).json({ error: 'userIds must be a non-empty array' });
    }

    const CHUNK = 500;
    let totalBanned = 0;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const idChunk = userIds.slice(i, i + CHUNK);
      // Single UPDATE round trip for the entire chunk
      const { rowCount } = await db.query(
        `UPDATE users SET banned = true, updated_at = now() WHERE id = ANY($1::text[])`,
        [idChunk]
      );
      totalBanned += rowCount;
      await endSessions(idChunk);
    }

    logger.info({ admin: req.user.id, count: totalBanned }, 'Bulk ban applied');
    res.json({ message: `${totalBanned} user(s) banned` });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/admin/users/bulk-unban ────────────────────────────
async function bulkUnbanUsers(req, res, next) {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || !userIds.length) {
      return res.status(400).json({ error: 'userIds must be a non-empty array' });
    }

    const CHUNK = 500;
    let totalUnbanned = 0;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const idChunk = userIds.slice(i, i + CHUNK);
      const { rowCount } = await db.query(
        `UPDATE users SET banned = false, updated_at = now() WHERE id = ANY($1::text[])`,
        [idChunk]
      );
      totalUnbanned += rowCount;
      await endSessions(idChunk, { disconnect: false });
    }

    logger.info({ admin: req.user.id, count: totalUnbanned }, 'Bulk unban applied');
    res.json({ message: `${totalUnbanned} user(s) unbanned` });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/algorithm ────────────────────────────────────
async function getAlgorithmWeights(req, res, next) {
  try {
    const { rows } = await db.query("SELECT value FROM admin_settings WHERE key = 'algorithm_weights'");
    if (!rows.length) {
      return res.json({ CATEGORY_OVERLAP: 40, BUDGET_FIT: 30, LOCATION_MATCH: 20, COMPLETENESS: 10 });
    }
    res.json(rows[0].value);
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/admin/algorithm ────────────────────────────────────
async function updateAlgorithmWeights(req, res, next) {
  try {
    const { CATEGORY_OVERLAP, BUDGET_FIT, LOCATION_MATCH, COMPLETENESS } = req.body;
    
    // Ensure all values exist and add up to 100 (optional, but good practice).
    const weights = {
      CATEGORY_OVERLAP: CATEGORY_OVERLAP || 0,
      BUDGET_FIT: BUDGET_FIT || 0,
      LOCATION_MATCH: LOCATION_MATCH || 0,
      COMPLETENESS: COMPLETENESS || 0
    };

    await db.query(
      `INSERT INTO admin_settings (key, value, updated_at) 
       VALUES ('algorithm_weights', $1::jsonb, now()) 
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(weights)]
    );

    await invalidateWeights();

    logger.info({ admin: req.user.id, weights }, 'Algorithm weights updated');
    res.json(weights);
  } catch (err) {
    next(err);
  }
}

module.exports = { getStats, listUsers, banUser, unbanUser, deleteUser, bulkBanUsers, bulkUnbanUsers, getAlgorithmWeights, updateAlgorithmWeights };
