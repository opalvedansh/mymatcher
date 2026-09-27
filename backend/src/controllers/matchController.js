const db = require('../config/db');
const realtime = require('../realtime');
const { decrypt } = require('../utils/encryption');
const chat = require('../services/chat');

/**
 * Shared query — returns full match details including both profiles.
 * Uses explicit column selection (no p.*) to avoid data leaks.
 *
 * `viewer` is the placeholder holding the signed-in user's id: the inbox
 * preview skips what they deleted for themselves or cleared, and the unread
 * count and mute state are theirs.
 */
const matchQuery = (viewer) => `
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
    msg.read_at     AS last_message_read_at,
    msg.delivered_at AS last_message_delivered_at,
    msg.kind        AS last_message_kind,
    msg.attachment  AS last_message_attachment,
    msg.deleted_at  AS last_message_deleted_at,

    (SELECT count(*)::int FROM messages um
      WHERE um.match_id = m.id AND um.sender_id <> ${viewer} AND um.read_at IS NULL
        AND um.deleted_at IS NULL
        AND um.created_at > COALESCE(cs.cleared_at, '-infinity'::timestamptz)
        AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.user_id = ${viewer} AND h.message_id = um.id)
    )               AS unread_count,
    CASE WHEN cs.muted_until > now() THEN cs.muted_until END AS muted_until

  FROM matches m
  JOIN brand_profiles       bp ON bp.user_id = m.brand_id
  JOIN influencer_profiles  ip ON ip.user_id = m.influencer_id
  LEFT JOIN chat_member_state cs ON cs.match_id = m.id AND cs.user_id = ${viewer}
  LEFT JOIN LATERAL (
    SELECT content, created_at, sender_id, read_at, delivered_at, kind, attachment, deleted_at
    FROM messages lm
    WHERE lm.match_id = m.id
      AND lm.created_at > COALESCE(cs.cleared_at, '-infinity'::timestamptz)
      AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.user_id = ${viewer} AND h.message_id = lm.id)
    ORDER BY created_at DESC
    LIMIT 1
  ) msg ON true
`;

/**
 * Turns the last-message columns into what the chat list shows: the text,
 * or for an attachment its caption or a label ("Photo", or a file name).
 * The attachment itself never leaves the server here.
 */
async function withInboxPreview(row) {
  const { last_message_attachment: attachment, last_message_kind: kind, last_message_deleted_at: deletedAt } = row;
  delete row.last_message_attachment;
  if (!row.last_message_at) return row;
  if (deletedAt) {
    row.last_message = '';
    return row;
  }
  const text = row.last_message ? await decrypt(row.last_message) : '';
  row.last_message = text;
  if (kind && kind !== 'text') {
    const att = attachment ? await chat.openAttachment({ attachment }) : null;
    row.last_message_label = kind === 'document' ? (att?.name || 'Document') : chat.describeKind(kind);
    row.last_message_duration_ms = att?.duration_ms ?? null;
  }
  return row;
}

// ─── GET /api/matches ────────────────────────────────────────────
async function getMatches(req, res, next) {
  try {
    const { id: userId, role } = req.user;
    const column = role === 'brand' ? 'm.brand_id' : 'm.influencer_id';

    const limit = parseInt(req.query.limit, 10) || 50;
    const cursor = req.query.cursor || null;

    let query = `${matchQuery('$1')}
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
    const decryptedRows = await Promise.all(rows.map(withInboxPreview));

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
      `${matchQuery('$2')}
       WHERE m.id = $1
         AND (m.brand_id = $2 OR m.influencer_id = $2)`,
      [matchId, userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Match not found or access denied' });
    }

    res.json(await withInboxPreview(rows[0]));
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
