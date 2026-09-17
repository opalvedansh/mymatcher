const socketIo = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');
const { Filter } = require('bad-words');
const { verifySupabaseToken } = require('./utils/verifyToken');
const db = require('./config/db');
const logger = require('./config/logger');
const notificationService = require('./services/notificationService');
const { encrypt, decrypt } = require('./utils/encryption');
const realtime = require('./realtime');

const contentFilter = new Filter();

const MAX_MESSAGE_LENGTH = 2000;
const MAX_CLIENT_ID_LENGTH = 64;
// Token bucket per connection: bursts of 20 messages, refilling at 2 per second.
const MESSAGE_BURST = 20;
const MESSAGE_REFILL_PER_SEC = 2;
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

function takeToken(socket) {
  const now = Date.now();
  const bucket = socket.data.bucket;
  bucket.tokens = Math.min(MESSAGE_BURST, bucket.tokens + ((now - bucket.at) / 1000) * MESSAGE_REFILL_PER_SEC);
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
      socket.data.bucket = { tokens: MESSAGE_BURST, at: Date.now() };
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

    // Checks membership (cached across instances) and joins the match room.
    // Returns the other participant, or null when the user may not chat there.
    async function enterMatch(matchId) {
      if (typeof matchId !== 'string' || !matchId || matchId.length > 64) return null;
      const members = await realtime.getMatchMembers(matchId, db);
      if (!members || !members.includes(userId)) return null;
      socket.join(realtime.matchRoom(matchId));
      return members[0] === userId ? members[1] : members[0];
    }

    // Join a specific match's chat room
    socket.on('join_match', async (matchId, ack) => {
      try {
        const otherId = await enterMatch(matchId);
        if (!otherId) {
          socket.emit('error', { message: 'Match not found or unauthorized' });
          return reply(ack, { ok: false, error: 'not_found' });
        }
        reply(ack, { ok: true });
      } catch (err) {
        logger.error({ err: err.message }, '[Socket] join_match error');
        reply(ack, { ok: false, error: 'server_error' });
      }
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

    // Handle incoming messages.
    // Payload: { matchId, content, clientId? }. With a clientId, retries of the
    // same message are stored once and acked with the original.
    socket.on('send_message', async (data, ack) => {
      const { matchId, content, clientId } = data || {};
      if (typeof content !== 'string' || !content.trim()) {
        return reply(ack, { ok: false, error: 'empty' });
      }
      if (content.length > MAX_MESSAGE_LENGTH) {
        return reply(ack, { ok: false, error: 'too_long' });
      }
      if (clientId !== undefined && (typeof clientId !== 'string' || !clientId || clientId.length > MAX_CLIENT_ID_LENGTH)) {
        return reply(ack, { ok: false, error: 'bad_client_id' });
      }
      if (!takeToken(socket)) {
        socket.emit('error', { message: 'You are sending messages too fast' });
        return reply(ack, { ok: false, error: 'rate_limited' });
      }

      try {
        const receiverId = await enterMatch(matchId);
        if (!receiverId) {
          socket.emit('error', { message: 'Match not found or unauthorized' });
          return reply(ack, { ok: false, error: 'not_found' });
        }

        // Apply content moderation (profanity filter)
        let safeContent = content.trim();
        try {
          safeContent = contentFilter.clean(safeContent);
        } catch (e) {
          logger.warn({ err: e.message }, '[Socket] Content moderation failed');
        }

        const encryptedContent = await encrypt(safeContent);

        const { rows: msgRows } = await db.query(
          `INSERT INTO messages (match_id, sender_id, content, client_msg_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (sender_id, client_msg_id) WHERE client_msg_id IS NOT NULL DO NOTHING
           RETURNING *`,
          [matchId, userId, encryptedContent, clientId ?? null]
        );

        if (!msgRows.length) {
          // A retry of a message that was already stored and delivered.
          const { rows: existing } = await db.query(
            'SELECT * FROM messages WHERE sender_id = $1 AND client_msg_id = $2',
            [userId, clientId]
          );
          const original = existing[0];
          if (!original) return reply(ack, { ok: false, error: 'server_error' });
          original.content = await decrypt(original.content);
          return reply(ack, { ok: true, message: original, duplicate: true });
        }

        const newMessage = msgRows[0];
        newMessage.content = await decrypt(newMessage.content);

        // Broadcast to everyone in the match room (including sender to confirm)
        io.to(realtime.matchRoom(matchId)).emit('receive_message', newMessage);
        reply(ack, { ok: true, message: newMessage });

        // Push notification in the background
        notificationService.sendChatNotification(receiverId, userId)
          .catch(err => logger.error({ err: err.message }, '[Socket] Push notification failed'));
      } catch (err) {
        logger.error({ err: err.message }, '[Socket] send_message error');
        socket.emit('error', { message: 'Failed to send message' });
        reply(ack, { ok: false, error: 'server_error' });
      }
    });

    // Typing indicators only reach rooms the user has been admitted to.
    socket.on('typing', (data) => {
      const { matchId, isTyping } = data || {};
      if (typeof matchId !== 'string') return;
      const room = realtime.matchRoom(matchId);
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit('typing', {
        userId,
        isTyping: isTyping === true,
      });
    });

    socket.on('disconnect', () => {
      logger.debug({ userId }, '[Socket] disconnected');
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
