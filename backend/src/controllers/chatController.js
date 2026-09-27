const db = require('../config/db');
const logger = require('../config/logger');
const chat = require('../services/chat');
const realtime = require('../realtime');
const { createUploadTarget, ChatStorageError } = require('../utils/chatStorage');

/** The other participant when `userId` is in this active match, else null. */
async function otherMember(matchId, userId) {
  const { rows } = await db.query(
    `SELECT brand_id, influencer_id FROM matches
      WHERE id = $1 AND (brand_id = $2 OR influencer_id = $2) AND status = 'active'`,
    [matchId, userId]
  );
  if (!rows.length) return null;
  return rows[0].brand_id === userId ? rows[0].influencer_id : rows[0].brand_id;
}

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

    const otherId = await otherMember(matchId, userId);
    if (!otherId) {
      return res.status(403).json({ error: 'Match not found or access denied' });
    }

    const { messages, nextCursor } = await chat.listMessages(matchId, userId, { limit, cursor });

    // Opening the conversation reads it. The sender sees blue ticks at once.
    const { count, at } = await chat.markRead(matchId, userId);
    if (count) {
      realtime.emitToUser(otherId, 'messages_read', { matchId, readerId: userId, at });
      realtime.emitToUser(userId, 'messages_read', { matchId, readerId: userId, at });
    }

    res.json({
      data: messages,
      next_cursor: nextCursor,
      // Only the first page carries it; older pages don't need it again.
      ...(cursor ? {} : { state: await chat.getMemberState(matchId, userId) }),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/chat/:matchId/uploads
 * Body: { kind: 'image'|'video'|'audio'|'document', mime, size, name? }
 * Returns a one-time signed URL to PUT the file to, and the path to send.
 */
async function createUpload(req, res, next) {
  try {
    const { matchId } = req.params;
    const { id: userId } = req.user;
    if (!(await otherMember(matchId, userId))) {
      return res.status(403).json({ error: 'Match not found or access denied' });
    }
    const { kind, mime, size, name } = req.body;
    const target = await createUploadTarget(userId, { kind, mime, size, name });
    res.status(201).json({ path: target.path, upload_url: target.uploadUrl, max_bytes: target.maxBytes });
  } catch (err) {
    if (err instanceof ChatStorageError) {
      const status = err.code === 'storage_unavailable' ? 503 : err.code === 'too_large' ? 413 : 422;
      if (status === 503) logger.error({ err: err.message }, '[chat] upload target failed');
      return res.status(status).json({ error: err.message, code: err.code });
    }
    next(err);
  }
}

/** POST /api/chat/:matchId/clear — "Clear chat" for the signed-in user only. */
async function clearChat(req, res, next) {
  try {
    const { matchId } = req.params;
    const { id: userId } = req.user;
    if (!(await otherMember(matchId, userId))) {
      return res.status(403).json({ error: 'Match not found or access denied' });
    }
    const clearedAt = await chat.clearChat(matchId, userId);
    realtime.emitToUser(userId, 'chat_cleared', { matchId, at: clearedAt });
    res.json({ cleared_at: clearedAt });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/chat/:matchId/mute — Body: { duration: '8h'|'1w'|'always'|null } */
async function muteChat(req, res, next) {
  try {
    const { matchId } = req.params;
    const { id: userId } = req.user;
    if (!(await otherMember(matchId, userId))) {
      return res.status(403).json({ error: 'Match not found or access denied' });
    }
    const mutedUntil = await chat.setMute(matchId, userId, req.body.duration ?? null);
    res.json({ muted_until: mutedUntil });
  } catch (err) {
    if (err instanceof chat.ChatError) return res.status(422).json({ error: err.code });
    next(err);
  }
}

module.exports = { getMessages, createUpload, clearChat, muteChat };
