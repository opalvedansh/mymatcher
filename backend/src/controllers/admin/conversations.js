const db = require('../../config/db');
const logger = require('../../config/logger');
const { recordFromRequest } = require('../../services/adminAudit');
const { safeDecrypt } = require('./moderation');
const { encodeCursor, decodeCursor, clampLimit } = require('../../utils/adminQuery');

/**
 * Conversation access, in tiers.
 *
 * messages.content is AES-encrypted at rest (utils/encryption.js) so that
 * holding the database is not the same as holding people's conversations. An
 * endpoint that decrypts any thread on request hands every moderator — and
 * anyone who phishes a moderator's session — exactly the capability that
 * encryption was bought to prevent, and the key stops being a security
 * boundary and becomes a formality.
 *
 *   matches:read   metadata and shape only, never content
 *   reports:write  the reported message ±5 neighbours (see moderation.js)
 *   messages:read  the full thread, superadmin only, reason required,
 *                  audit written before decryption, 10 per hour
 */

// ─── GET /api/admin/matches ──────────────────────────────────────
async function listMatches(req, res, next) {
  try {
    const limit = clampLimit(req.query.limit, 50, 100);
    const where = [];
    const params = [];
    const add = (v) => `$${params.push(v)}`;

    if (req.query.status) where.push(`m.status = ${add(req.query.status)}::match_status`);
    if (req.query.user_id) {
      const p = add(req.query.user_id);
      where.push(`(m.brand_id = ${p} OR m.influencer_id = ${p})`);
    }
    if (req.query.from) where.push(`m.matched_at >= ${add(req.query.from)}::date`);
    if (req.query.to) where.push(`m.matched_at < (${add(req.query.to)}::date + 1)`);

    const cursor = decodeCursor(req.query.cursor);
    if (cursor) {
      where.push(`(m.matched_at, m.id::text) < ($${params.push(cursor.ts)}::timestamptz, $${params.push(cursor.id)})`);
    }

    const { rows } = await db.query(
      `SELECT m.id, m.brand_id, m.influencer_id, m.status, m.relevance_score, m.matched_at,
              bp.name AS brand_name, ip.name AS influencer_name,
              (SELECT count(*)      FROM messages ms WHERE ms.match_id = m.id)::int AS message_count,
              (SELECT max(created_at) FROM messages ms WHERE ms.match_id = m.id)    AS last_message_at,
              EXISTS (SELECT 1 FROM reports r
                       WHERE r.target_type = 'message'
                         AND r.target_id IN (SELECT id::text FROM messages ms WHERE ms.match_id = m.id))
                                                                                    AS reported
         FROM matches m
         LEFT JOIN brand_profiles      bp ON bp.user_id = m.brand_id
         LEFT JOIN influencer_profiles ip ON ip.user_id = m.influencer_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY m.matched_at DESC, m.id DESC
        LIMIT $${params.push(limit + 1)}`,
      params
    );

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    res.json({
      data,
      next_cursor: hasMore ? encodeCursor(data[data.length - 1].matched_at, data[data.length - 1].id) : null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/matches/:matchId ─────────────────────────────
async function getMatch(req, res, next) {
  try {
    const { matchId } = req.params;
    const { rows: [match] } = await db.query(
      `SELECT m.*, bp.name AS brand_name, bp.logo_url AS brand_avatar,
              ip.name AS influencer_name, ip.avatar_url AS influencer_avatar
         FROM matches m
         LEFT JOIN brand_profiles      bp ON bp.user_id = m.brand_id
         LEFT JOIN influencer_profiles ip ON ip.user_id = m.influencer_id
        WHERE m.id = $1::uuid`,
      [matchId]
    );
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const { rows: [stats] } = await db.query(
      `SELECT count(*)::int                                            AS message_count,
              min(created_at)                                          AS first_message_at,
              max(created_at)                                          AS last_message_at,
              count(*) FILTER (WHERE sender_id = $2)::int              AS brand_messages,
              count(*) FILTER (WHERE sender_id = $3)::int              AS influencer_messages,
              count(*) FILTER (WHERE read_at IS NULL)::int             AS unread_count
         FROM messages WHERE match_id = $1::uuid`,
      [matchId, match.brand_id, match.influencer_id]
    );

    res.json({ match, stats });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/matches/:matchId/timeline ────────────────────
//
// The shape of a conversation without a word of it: who sent what when, and
// how long each message was. Enough to see one-sided spam, a burst of
// messages at 3am, or a thread that died — without decrypting anything.
async function getTimeline(req, res, next) {
  try {
    const limit = clampLimit(req.query.limit, 200, 500);
    const params = [req.params.matchId];
    const where = ['match_id = $1::uuid'];

    const cursor = decodeCursor(req.query.cursor);
    if (cursor) {
      where.push(`(created_at, id::text) < ($${params.push(cursor.ts)}::timestamptz, $${params.push(cursor.id)})`);
    }

    const { rows } = await db.query(
      `SELECT id, sender_id, created_at, read_at, length(content) AS cipher_length
         FROM messages
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.push(limit + 1)}`,
      params
    );

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    res.json({
      data: data.map((m) => ({
        id: m.id,
        sender_id: m.sender_id,
        created_at: m.created_at,
        read_at: m.read_at,
        // Ciphertext length, not plaintext: AES-GCM plus base64 makes this a
        // rough proxy for message size and nothing more precise.
        cipher_length: Number(m.cipher_length),
      })),
      next_cursor: hasMore ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id) : null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/matches/:matchId/messages ────────────────────
//
// The only route that decrypts a whole conversation. superadmin only
// (requireAdmin('messages:read')), a written reason, a rate limit of 10/hour,
// and an audit row written before a single byte is decrypted.
async function getMessages(req, res, next) {
  try {
    const { matchId } = req.params;
    const reason = String(req.query.reason || req.body?.reason || '').trim();
    if (reason.length < 10) {
      return res.status(422).json({
        error: 'A written reason of at least 10 characters is required to read a conversation',
      });
    }

    const { rows: [match] } = await db.query(
      'SELECT id, brand_id, influencer_id FROM matches WHERE id = $1::uuid', [matchId]
    );
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const limit = clampLimit(req.query.limit, 100, 200);
    const params = [matchId];
    const where = ['match_id = $1::uuid'];
    const cursor = decodeCursor(req.query.cursor);
    if (cursor) {
      where.push(`(created_at, id::text) < ($${params.push(cursor.ts)}::timestamptz, $${params.push(cursor.id)})`);
    }

    const { rows } = await db.query(
      `SELECT id, sender_id, content, created_at, read_at
         FROM messages WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.push(limit + 1)}`,
      params
    );

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    // Written BEFORE decryption, deliberately. If this insert throws, nothing
    // is revealed. If the process dies immediately after, the record of what
    // was about to be revealed is already durable. The finish hook will only
    // patch the status onto this row.
    const auditRow = await recordFromRequest(req, {
      action: 'messages.read_thread',
      targetType: 'match',
      targetId: matchId,
      reason,
      metadata: {
        participants: [match.brand_id, match.influencer_id],
        message_count: data.length,
        message_ids: data.map((m) => m.id),
      },
    });
    req.audit.rowId = auditRow.id;

    // Also logged at warn so it surfaces in Sentry and Railway without
    // anyone having to think to query the audit table.
    logger.warn(
      { admin: req.admin.id, matchId, count: data.length, reason },
      'Admin read a full conversation',
    );

    res.json({
      match_id: matchId,
      data: data.map((m) => ({
        id: m.id,
        sender_id: m.sender_id,
        created_at: m.created_at,
        read_at: m.read_at,
        content: safeDecrypt(m.content),
      })),
      next_cursor: hasMore ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id) : null,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listMatches, getMatch, getTimeline, getMessages };
