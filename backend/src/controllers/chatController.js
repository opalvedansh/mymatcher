const db = require('../config/db');
const { decrypt } = require('../utils/encryption');

/**
 * GET /api/chat/:matchId/messages
 * Retrieves historical messages for a specific match, paginated.
 * Query Params: limit, cursor (date)
 */
async function getMessages(req, res, next) {
  try {
    const { matchId } = req.params;
    const { id: userId } = req.user;
    const limit = parseInt(req.query.limit, 10) || 50;
    const cursor = req.query.cursor || null;

    // 1. Verify user is part of the match
    const { rows: matchRows } = await db.query(
      `SELECT id FROM matches 
       WHERE id = $1 AND (brand_id = $2 OR influencer_id = $2) AND status = 'active'`,
      [matchId, userId]
    );

    if (!matchRows.length) {
      return res.status(403).json({ error: 'Match not found or access denied' });
    }

    // 2. Fetch messages ordered by time descending (newest first)
    // We use cursor-based pagination
    let query = `
      SELECT id, sender_id, content, created_at, read_at
      FROM messages
      WHERE match_id = $1
    `;
    const params = [matchId];

    if (cursor) {
      query += ` AND created_at < $2`;
      params.push(cursor);
      query += ` ORDER BY created_at DESC LIMIT $3`;
      params.push(limit);
    } else {
      query += ` ORDER BY created_at DESC LIMIT $2`;
      params.push(limit);
    }

    const { rows } = await db.query(query, params);

    // 3. Mark received messages as read
    const unreadIds = rows
      .filter(m => m.sender_id !== userId && !m.read_at)
      .map(m => m.id);

    if (unreadIds.length > 0) {
      await db.query(
        `UPDATE messages SET read_at = now() WHERE id = ANY($1::uuid[])`,
        [unreadIds]
      );
      // The inbox item for this conversation is read once the chat is opened.
      await db.query(
        `UPDATE notifications SET read_at = now()
         WHERE user_id = $1 AND match_id = $2 AND type = 'new_message' AND read_at IS NULL`,
        [userId, matchId]
      );
    }

    // 4. Decrypt messages before sending to client
    const decryptedRows = await Promise.all(
      rows.map(async (m) => {
        m.content = await decrypt(m.content);
        return m;
      })
    );

    res.json({
      data: decryptedRows,
      next_cursor: rows.length === limit ? rows[rows.length - 1].created_at : null
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMessages };
