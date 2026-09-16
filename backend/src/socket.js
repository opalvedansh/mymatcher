const socketIo = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');
const { Filter } = require('bad-words');
const { verifySupabaseToken } = require('./utils/verifyToken');
const db = require('./config/db');
const notificationService = require('./services/notificationService');
const { encrypt, decrypt } = require('./utils/encryption');

const contentFilter = new Filter();

let io;

/**
 * Initializes the Socket.io server and attaches it to the provided HTTP server.
 */
function initSocket(server) {
  io = socketIo(server, {
    cors: {
      // Mirror the same origin policy used by the Express CORS middleware.
      // Native mobile clients send no Origin header and are always allowed.
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // native mobile / server-to-server
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
        const allowed = (process.env.ALLOWED_ORIGINS || '')
          .split(',')
          .map(o => o.trim())
          .filter(Boolean);
        if (allowed.includes(origin) || process.env.ALLOWED_ORIGINS === '*') return cb(null, true);
        return cb(null, false);
      },
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket']
  });

  // ─── Redis Adapter (Optional for horizontal scaling) ─────────────
  if (process.env.REDIS_URL) {
    try {
      const pubClient = new Redis(process.env.REDIS_URL, { family: 0, enableOfflineQueue: false });
      const subClient = pubClient.duplicate();

      // MUST attach error handlers — otherwise Node emits an unhandled 'error' event
      pubClient.on('error', (err) => console.error('[Socket] Redis pub error:', err.message));
      subClient.on('error', (err) => console.error('[Socket] Redis sub error:', err.message));
      pubClient.on('connect', () => console.log('[Socket] Redis pub connected'));

      io.adapter(createAdapter(pubClient, subClient));
      console.log('[Socket] Redis Adapter enabled for horizontal scaling');
    } catch (err) {
      console.error('[Socket] Failed to set up Redis adapter — falling back to in-process:', err.message);
    }
  }

  // ─── Middleware: Authenticate WebSocket Connection ───────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error: Token missing'));
    }

    try {
      const verified = await verifySupabaseToken(token);
      socket.user = { id: verified.sub };
      next();
    } catch (err) {
      console.error('[Socket Auth] Error:', err.message);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // ─── Connection Handler ──────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log(`[Socket] User connected: ${socket.user.id}`);
    
    // User joins a personal room (for direct notifications)
    socket.join(`user_${socket.user.id}`);

    // Join a specific match's chat room
    socket.on('join_match', async (matchId) => {
      // 1. Verify user is part of this match
      try {
        const { rows } = await db.query(
          `SELECT id, brand_id, influencer_id FROM matches 
           WHERE id = $1 AND (brand_id = $2 OR influencer_id = $2) AND status = 'active'`,
          [matchId, socket.user.id]
        );

        if (!rows.length) {
          return socket.emit('error', { message: 'Match not found or unauthorized' });
        }

        const room = `match_${matchId}`;
        socket.join(room);
        console.log(`[Socket] User ${socket.user.id} joined room ${room}`);
      } catch (err) {
        console.error('[Socket] join_match error:', err);
      }
    });

    // Handle incoming messages
    socket.on('send_message', async (data) => {
      const { matchId, content } = data;
      if (!matchId || !content || !content.trim()) return;

      try {
        // 1. Verify match access and get receiver ID
        const { rows: matchRows } = await db.query(
          `SELECT brand_id, influencer_id FROM matches 
           WHERE id = $1 AND (brand_id = $2 OR influencer_id = $2) AND status = 'active'`,
          [matchId, socket.user.id]
        );

        if (!matchRows.length) {
          return socket.emit('error', { message: 'Match not found or unauthorized' });
        }
        
        const match = matchRows[0];
        const receiverId = match.brand_id === socket.user.id ? match.influencer_id : match.brand_id;

        // Apply content moderation (profanity filter)
        let safeContent = content.trim();
        try {
          safeContent = contentFilter.clean(safeContent);
        } catch (e) {
          console.error('[Socket] Content moderation failed:', e);
        }

        // Encrypt content for DB storage
        const encryptedContent = await encrypt(safeContent);

        // 2. Insert encrypted message into DB
        const { rows: msgRows } = await db.query(
          `INSERT INTO messages (match_id, sender_id, content) 
           VALUES ($1, $2, $3) RETURNING *`,
          [matchId, socket.user.id, encryptedContent]
        );
        const newMessage = msgRows[0];
        
        // Decrypt it to send over the websocket immediately
        newMessage.content = await decrypt(newMessage.content);

        // 3. Broadcast to everyone in the match room (including sender to confirm)
        io.to(`match_${matchId}`).emit('receive_message', newMessage);

        // 4. Trigger Push Notification to the receiver
        // (Don't await this, let it happen in background)
        notificationService.sendChatNotification(receiverId, socket.user.id)
          .catch(err => console.error('[Socket] Push notification failed:', err));

      } catch (err) {
        console.error('[Socket] send_message error:', err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle typing indicators
    socket.on('typing', (data) => {
      const { matchId, isTyping } = data;
      if (!matchId) return;
      socket.to(`match_${matchId}`).emit('typing', {
        userId: socket.user.id,
        isTyping
      });
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] User disconnected: ${socket.user.id}`);
    });
  });
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

module.exports = { initSocket, getIO };
