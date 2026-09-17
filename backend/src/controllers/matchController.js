const db = require('../config/db');
const realtime = require('../realtime');
const { decrypt } = require('../utils/encryption');

/**
 * Shared query — returns full match details including both profiles.
 * Uses explicit column selection (no p.*) to avoid data leaks.
 */
const MATCH_QUERY = `
  SELECT
    m.id            AS match_id,
    m.status,
    m.matched_at,
    m.relevance_score,

    -- Brand info
    m.brand_id,
    bp.name         AS brand_name,
    bp.logo_url     AS brand_logo,
    bp.cover_url    AS brand_cover,
    bp.bio          AS brand_bio,
    bp.categories   AS brand_categories,
    bp.location     AS brand_location,
    bp.budget_min,
    bp.budget_max,
    bp.campaign_types,
    bp.vibes,
    bp.website      AS brand_website,
    bp.verified     AS brand_verified,

    -- Influencer info
    m.influencer_id,
    ip.name         AS influencer_name,
    ip.avatar_url   AS influencer_avatar,
    ip.cover_url    AS influencer_cover,
    ip.bio          AS influencer_bio,
    ip.categories   AS influencer_categories,
    ip.location     AS influencer_location,
    ip.followers,
    ip.engagement_rate,
    ip.avg_views,
    ip.platforms,
    ip.price_min,
    ip.price_max,
    ip.verified     AS influencer_verified,

    msg.content     AS last_message,
    msg.created_at  AS last_message_at,
    msg.sender_id   AS last_message_sender,
    msg.read_at     AS last_message_read_at

  FROM matches m
  JOIN brand_profiles       bp ON bp.user_id = m.brand_id
  JOIN influencer_profiles  ip ON ip.user_id = m.influencer_id
  LEFT JOIN LATERAL (
    SELECT content, created_at, sender_id, read_at
    FROM messages 
    WHERE match_id = m.id 
    ORDER BY created_at DESC 
    LIMIT 1
  ) msg ON true
`;

// ─── GET /api/matches ────────────────────────────────────────────
async function getMatches(req, res, next) {
  try {
    const { id: userId, role } = req.user;
    const column = role === 'brand' ? 'm.brand_id' : 'm.influencer_id';

    const limit = parseInt(req.query.limit, 10) || 50;
    const cursor = req.query.cursor || null;

    let query = `${MATCH_QUERY}
       WHERE ${column} = $1
         AND m.status = 'active'`;
    
    const params = [userId];

    if (cursor) {
      query += ` AND m.matched_at < $2`;
      params.push(cursor);
    }

    query += ` ORDER BY m.matched_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await db.query(query, params);

    // Decrypt the last message for each match
    const decryptedRows = await Promise.all(
      rows.map(async (row) => {
        if (row.last_message) {
          row.last_message = await decrypt(row.last_message);
        }
        return row;
      })
    );

    res.json({
      data: decryptedRows,
      next_cursor: rows.length === limit ? rows[rows.length - 1].matched_at : null
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/matches/stats ──────────────────────────────────────
async function getMatchStats(req, res, next) {
  try {
    const { id: userId, role } = req.user;
    const column = role === 'brand' ? 'm.brand_id' : 'm.influencer_id';

    const { rows: [stats] } = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE m.status = 'active')   AS total_active,
         COUNT(*) FILTER (WHERE m.status = 'archived') AS total_archived,
         ROUND(AVG(m.relevance_score), 1)              AS avg_relevance_score,
         ROUND(MAX(m.relevance_score), 1)              AS top_relevance_score
       FROM matches m
       WHERE ${column} = $1`,
      [userId]
    );

    // Top categories from active matches
    const { rows: topCategories } = await db.query(
      role === 'brand'
        ? `SELECT unnest(ip.categories) AS category, COUNT(*) AS count
           FROM matches m
           JOIN influencer_profiles ip ON ip.user_id = m.influencer_id
           WHERE m.brand_id = $1 AND m.status = 'active'
           GROUP BY category ORDER BY count DESC LIMIT 5`
        : `SELECT unnest(bp.categories) AS category, COUNT(*) AS count
           FROM matches m
           JOIN brand_profiles bp ON bp.user_id = m.brand_id
           WHERE m.influencer_id = $1 AND m.status = 'active'
           GROUP BY category ORDER BY count DESC LIMIT 5`,
      [userId]
    );

    res.json({
      ...stats,
      top_categories: topCategories,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/matches/:matchId ───────────────────────────────────
async function getMatchById(req, res, next) {
  try {
    const { matchId } = req.params;
    const { id: userId } = req.user;

    const { rows } = await db.query(
      `${MATCH_QUERY}
       WHERE m.id = $1
         AND (m.brand_id = $2 OR m.influencer_id = $2)`,
      [matchId, userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Match not found or access denied' });
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/matches/:matchId ────────────────────────────────
async function archiveMatch(req, res, next) {
  try {
    const { matchId } = req.params;
    const { id: userId } = req.user;

    const { rowCount } = await db.query(
      `UPDATE matches
       SET status = 'archived'
       WHERE id = $1
         AND (brand_id = $2 OR influencer_id = $2)
         AND status = 'active'`,
      [matchId, userId]
    );
    if (rowCount) await realtime.closeMatches([matchId]);

    if (!rowCount) {
      return res.status(404).json({ error: 'Match not found or already archived' });
    }

    res.json({ message: 'Match archived successfully' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMatches, getMatchStats, getMatchById, archiveMatch };
