const socketIo = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');
const { verifySupabaseToken } = require('./utils/verifyToken');
const db = require('./config/db');
const logger = require('./config/logger');
const notificationService = require('./services/notificationService');
const chat = require('./services/chat');
const realtime = require('./realtime');

// Token buckets per connection. Actions that write a message (send, edit,
// delete, react, forward) share one: bursts of 20, refilling at 2 per second.
// Read and delivery receipts arrive in bursts whenever a batch of messages
// does, so they get their own, larger bucket and never block a send.
const BUCKETS = {
  write: { burst: 20, perSec: 2 },
  receipt: { burst: 60, perSec: 10 },
};
// How often each chat instance re-checks its connected users for bans and
// expired tokens.
const SWEEP_INTERVAL_MS = Number(process.env.SOCKET_SWEEP_INTERVAL_MS) || 5 * 60 * 1000;
// Old app builds never refresh the token on an open socket, so hard expiry is
// opt-in until every client in use sends `refresh_token`.
const ENFORCE_TOKEN_EXPIRY = process.env.SOCKET_ENFORCE_TOKEN_EXPIRY === 'true';
const TOKEN_EXPIRY_GRACE_SEC = 5 * 60;

let io;
let sweepTimer;

function allowOrigin(origin, cb) {
  // Mirror the same origin policy used by the Express CORS middleware.
  // Native mobile clients send no Origin header and are always allowed.
  if (!origin) return cb(null, true);
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
  if (allowed.includes(origin) || process.env.ALLOWED_ORIGINS === '*') return cb(null, true);
  return cb(null, false);
}

function takeToken(socket, kind = 'write') {
  const { burst, perSec } = BUCKETS[kind];
  const now = Date.now();
  const bucket = socket.data.buckets[kind];
  bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.at) / 1000) * perSec);
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

// Acks are optional: older clients emit without a callback.
function reply(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

async function isBanned(userId) {
  const { rows } = await db.query('SELECT banned FROM users WHERE id = $1', [userId]);
  return rows[0]?.banned === true;
}

/** Every socket in the conversation plus both people's other devices (and the chat list). */
function toConversation(matchId, userIds) {
  return io.to([realtime.matchRoom(matchId), ...userIds.map(realtime.userRoom)]);
}

const presenceRoom = (userId) => `presence_${userId}`;

async function isOnline(userId) {
  const sockets = await io.in(realtime.userRoom(userId)).fetchSockets();
  return sockets.length > 0;
}

/** Disconnects banned users and (when enforced) expired tokens on this instance. */
async function sweep() {
  const sockets = await io.local.fetchSockets();
  if (!sockets.length) return;
  const nowSec = Date.now() / 1000;

  const userIds = [...new Set(sockets.map((s) => s.data.userId))];
  const { rows } = await db.query(
    'SELECT id FROM users WHERE id = ANY($1::text[]) AND banned = true',
    [userIds]
  );
  const banned = new Set(rows.map((r) => r.id));

  for (const socket of sockets) {
    const expired = ENFORCE_TOKEN_EXPIRY && socket.data.tokenExp && socket.data.tokenExp + TOKEN_EXPIRY_GRACE_SEC < nowSec;
    if (banned.has(socket.data.userId) || expired) {
      socket.emit('session_ended', { reason: banned.has(socket.data.userId) ? 'banned' : 'token_expired' });
      socket.disconnect(true);
    }
  }
}

/**
 * Initializes the Socket.io server and attaches it to the provided HTTP server.
 */
function initSocket(server) {
  io = socketIo(server, {
    cors: {
      origin: allowOrigin,
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket'],
    maxHttpBufferSize: 64 * 1024,
  });

  // ─── Redis Adapter (required when running more than one instance) ──
  if (process.env.REDIS_URL) {
    try {
      // The offline queue must stay on: the adapter subscribes as soon as it is
      // created, before the connection is up, and a rejected subscribe is an
      // unhandled rejection that kills the process.
      const pubClient = new Redis(process.env.REDIS_URL, { family: 0 });
      const subClient = pubClient.duplicate();

      // MUST attach error handlers — otherwise Node emits an unhandled 'error' event
      pubClient.on('error', (err) => logger.error({ err: err.message }, '[Socket] Redis pub error'));
      subClient.on('error', (err) => logger.error({ err: err.message }, '[Socket] Redis sub error'));

      io.adapter(createAdapter(pubClient, subClient));
      logger.info('[Socket] Redis adapter enabled for horizontal scaling');
    } catch (err) {
      logger.error({ err: err.message }, '[Socket] Failed to set up Redis adapter — falling back to in-process');
    }
  } else if (process.env.NODE_ENV === 'production') {
    logger.warn('[Socket] REDIS_URL not set — chat only works with a single instance');
  }

  realtime.setServer(io);

  // ─── Middleware: Authenticate WebSocket Connection ───────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication error: Token missing'));
    }

    try {
      const verified = await verifySupabaseToken(token);
      if (await isBanned(verified.sub)) {
        return next(new Error('Authentication error: Account suspended'));
      }
      socket.data.userId = verified.sub;
      socket.data.tokenExp = verified.exp;
      socket.data.buckets = {
        write: { tokens: BUCKETS.write.burst, at: Date.now() },
        receipt: { tokens: BUCKETS.receipt.burst, at: Date.now() },
      };
      // Kept for existing handlers and tests that read socket.user.
      socket.user = { id: verified.sub };
      next();
    } catch (err) {
      logger.warn({ err: err.message }, '[Socket Auth] rejected');
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // ─── Connection Handler ──────────────────────────────────────────
  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    logger.debug({ userId }, '[Socket] connected');

    // User joins a personal room (for direct notifications)
    socket.join(realtime.userRoom(userId));

    io.to(presenceRoom(userId)).emit('presence', { userId, online: true, last_seen_at: null });

    // Messages that waited for this device are delivered now: tell the senders.
    chat.deliverPending(userId)
      .then((groups) => {
        for (const g of groups) {
          toConversation(g.match_id, [g.sender_id]).emit('messages_delivered', { matchId: g.match_id, at: g.at });
        }
      })
      .catch((err) => logger.error({ err: err.message }, '[Socket] delivery catch-up failed'));

    // Checks membership (cached across instances) and joins the match room.
    // Returns the other participant, or null when the user may not chat there.
    async function enterMatch(matchId) {
      if (typeof matchId !== 'string' || !matchId || matchId.length > 64) return null;
      const members = await realtime.getMatchMembers(matchId, db);
      if (!members || !members.includes(userId)) return null;
      socket.join(realtime.matchRoom(matchId));
      return members[0] === userId ? members[1] : members[0];
    }

    // Loads a message and admits the user to its conversation.
    async function enterMessage(messageId) {
      const row = await chat.getMessageRow(messageId);
      if (!row) return null;
      const otherId = await enterMatch(row.match_id);
      return otherId ? { row, otherId } : null;
    }

    /**
     * Wraps a handler: rate limit, then run it, turning ChatError into
     * { ok: false, error: code } and anything else into server_error.
     */
    function handle(event, bucket, fn) {
      socket.on(event, async (data, ack) => {
        if (bucket && !takeToken(socket, bucket)) {
          if (typeof ack !== 'function') socket.emit('error', { message: 'You are sending messages too fast' });
          return reply(ack, { ok: false, error: 'rate_limited' });
        }
        try {
          reply(ack, await fn(data || {}));
        } catch (err) {
          if (err instanceof chat.ChatError) return reply(ack, { ok: false, error: err.code });
          logger.error({ err: err.message, event }, '[Socket] handler error');
          // Clients without acks only learn about failures this way.
          if (typeof ack !== 'function') socket.emit('error', { message: 'Failed to send message' });
          reply(ack, { ok: false, error: 'server_error' });
        }
      });
    }

    // Join a specific match's chat room
    socket.on('join_match', async (matchId, ack) => {
      try {
        const otherId = await enterMatch(matchId);
        if (!otherId) {
          if (typeof ack !== 'function') socket.emit('error', { message: 'Match not found or unauthorized' });
          return reply(ack, { ok: false, error: 'not_found' });
        }
        reply(ack, { ok: true });
      } catch (err) {
        logger.error({ err: err.message }, '[Socket] join_match error');
        reply(ack, { ok: false, error: 'server_error' });
      }
    });

    socket.on('leave_match', (matchId) => {
      if (typeof matchId === 'string') socket.leave(realtime.matchRoom(matchId));
    });

    // Lets clients keep a long-lived connection past the hourly token expiry.
    socket.on('refresh_token', async (token, ack) => {
      try {
        const verified = await verifySupabaseToken(token);
        if (verified.sub !== userId) return reply(ack, { ok: false, error: 'wrong_user' });
        socket.data.tokenExp = verified.exp;
        reply(ack, { ok: true });
      } catch {
        reply(ack, { ok: false, error: 'invalid_token' });
      }
    });

    // Payload: { matchId, content?, clientId?, kind?, attachment?, replyToId? }.
    // With a clientId, retries of the same message are stored once and acked
    // with the original.
    handle('send_message', 'write', async (data) => {
      const receiverId = await enterMatch(data.matchId);
      if (!receiverId) return { ok: false, error: 'not_found' };

      const { message, duplicate } = await chat.createMessage({ matchId: data.matchId, senderId: userId, input: data });
      if (duplicate) return { ok: true, message, duplicate: true };

      toConversation(data.matchId, [userId, receiverId]).emit('receive_message', message);
      notificationService.sendChatNotification(receiverId, userId, data.matchId, { kind: message.kind })
        .catch(err => logger.error({ err: err.message }, '[Socket] Push notification failed'));
      return { ok: true, message };
    });

    // { messageId, content }
    handle('edit_message', 'write', async ({ messageId, content }) => {
      const found = await enterMessage(messageId);
      if (!found) return { ok: false, error: 'not_found' };
      const message = await chat.editMessage(found.row, userId, content);
      toConversation(found.row.match_id, [userId, found.otherId]).emit('message_updated', message);
      return { ok: true, message };
    });

    // { messageId, scope: 'everyone' } or { matchId, messageIds, scope: 'me' }
    handle('delete_message', 'write', async ({ messageId, messageIds, matchId, scope }) => {
      if (scope === 'me') {
        if (!(await enterMatch(matchId))) return { ok: false, error: 'not_found' };
        const hidden = await chat.hideForMe(matchId, userId, messageIds ?? messageId);
        // The user's other devices hide them too.
        socket.to(realtime.userRoom(userId)).emit('messages_hidden', { matchId, ids: hidden });
        return { ok: true, ids: hidden };
      }
      const found = await enterMessage(messageId);
      if (!found) return { ok: false, error: 'not_found' };
      const message = await chat.deleteForEveryone(found.row, userId);
      toConversation(found.row.match_id, [userId, found.otherId]).emit('message_updated', message);
      return { ok: true, message };
    });

    // { messageId, emoji } — a falsy emoji removes the reaction.
    handle('react_message', 'write', async ({ messageId, emoji }) => {
      const found = await enterMessage(messageId);
      if (!found) return { ok: false, error: 'not_found' };
      const reactions = await chat.setReaction(found.row, userId, emoji);
      toConversation(found.row.match_id, [userId, found.otherId])
        .emit('message_reactions', { matchId: found.row.match_id, messageId: found.row.id, reactions });
      return { ok: true, reactions };
    });

    // { messageId, matchIds: [...] } — copies a message into other chats.
    handle('forward_message', 'write', async ({ messageId, matchIds }) => {
      if (!Array.isArray(matchIds) || !matchIds.length || matchIds.length > chat.MAX_FORWARD_TARGETS) {
        return { ok: false, error: 'bad_targets' };
      }
      const found = await enterMessage(messageId);
      if (!found) return { ok: false, error: 'not_found' };

      const receivers = new Map();
      for (const targetId of new Set(matchIds)) {
        const otherId = await enterMatch(targetId);
        if (!otherId) return { ok: false, error: 'not_found' };
        receivers.set(targetId, otherId);
      }
      const messages = await chat.forwardMessage(found.row, userId, [...receivers.keys()]);
      for (const message of messages) {
        const receiverId = receivers.get(message.match_id);
        toConversation(message.match_id, [userId, receiverId]).emit('receive_message', message);
        notificationService.sendChatNotification(receiverId, userId, message.match_id, { kind: message.kind })
          .catch(err => logger.error({ err: err.message }, '[Socket] Push notification failed'));
      }
      return { ok: true, messages };
    });

    // { matchId } — the user has seen everything in this conversation.
    handle('mark_read', 'receipt', async ({ matchId }) => {
      const otherId = await enterMatch(matchId);
      if (!otherId) return { ok: false, error: 'not_found' };
      const { count, at } = await chat.markRead(matchId, userId);
      if (count) toConversation(matchId, [otherId, userId]).emit('messages_read', { matchId, readerId: userId, at });
      return { ok: true, count };
    });

    // { messageIds } — this device has received these messages.
    handle('mark_delivered', 'receipt', async ({ messageIds }) => {
      const groups = await chat.markDelivered(userId, messageIds);
      for (const g of groups) {
        toConversation(g.match_id, [g.sender_id]).emit('messages_delivered', { matchId: g.match_id, at: g.at });
      }
      return { ok: true };
    });

    // Online / last seen for someone this user is matched with.
    handle('watch_presence', 'receipt', async ({ userId: otherId }) => {
      if (typeof otherId !== 'string' || !otherId || otherId === userId) return { ok: false, error: 'bad_user' };
      const { rows } = await db.query(
        `SELECT u.last_seen_at FROM users u
          WHERE u.id = $2 AND EXISTS (
            SELECT 1 FROM matches m WHERE m.status = 'active'
               AND ((m.brand_id = $1 AND m.influencer_id = $2) OR (m.brand_id = $2 AND m.influencer_id = $1)))`,
        [userId, otherId]
      );
      if (!rows.length) return { ok: false, error: 'not_found' };
      socket.join(presenceRoom(otherId));
      return { ok: true, online: await isOnline(otherId), last_seen_at: rows[0].last_seen_at };
    });

    socket.on('unwatch_presence', (data) => {
      if (typeof data?.userId === 'string') socket.leave(presenceRoom(data.userId));
    });

    // Typing ("typing…") and recording ("recording audio…") indicators only
    // reach rooms the user has been admitted to.
    socket.on('typing', (data) => {
      const { matchId, isTyping, kind } = data || {};
      if (typeof matchId !== 'string') return;
      const room = realtime.matchRoom(matchId);
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit('typing', {
        matchId,
        userId,
        isTyping: isTyping === true,
        kind: kind === 'audio' ? 'audio' : 'text',
      });
    });

    socket.on('disconnect', async () => {
      logger.debug({ userId }, '[Socket] disconnected');
      try {
        // Another device (or a reconnect) may still be online.
        if (await isOnline(userId)) return;
        const { rows } = await db.query(
          'UPDATE users SET last_seen_at = now() WHERE id = $1 RETURNING last_seen_at',
          [userId]
        );
        io.to(presenceRoom(userId)).emit('presence', { userId, online: false, last_seen_at: rows[0]?.last_seen_at ?? null });
      } catch (err) {
        logger.warn({ err: err.message }, '[Socket] presence update failed');
      }
    });
  });

  sweepTimer = setInterval(() => {
    sweep().catch((err) => logger.error({ err: err.message }, '[Socket] sweep failed'));
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  return io;
}

/**
 * Helper to emit events from outside the socket context (e.g. REST controllers)
 */
function getIO() {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
}

function closeSocket() {
  clearInterval(sweepTimer);
  return io ? new Promise((resolve) => io.close(() => resolve())) : Promise.resolve();
}

module.exports = { initSocket, getIO, closeSocket, _sweep: sweep };
