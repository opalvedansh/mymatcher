const logger = require('../config/logger');
const sharedCache = require('../utils/sharedCache');

/**
 * Sends real-time events from anywhere in the backend, whether or not this
 * process runs the Socket.io server.
 *
 * - Socket server in this process: uses it directly (with the Redis adapter it
 *   already reaches sockets on every chat instance).
 * - API-only process (ENABLE_SOCKETS=false): publishes through the Socket.io
 *   Redis emitter, which the chat service's Redis adapter listens to.
 * - Neither: events are dropped with a warning; clients catch up over REST.
 */
let localIo = null;
let emitter;

function setServer(io) {
  localIo = io;
}

function getEmitter() {
  if (emitter !== undefined) return emitter;
  emitter = null;
  if (process.env.REDIS_URL && process.env.NODE_ENV !== 'test') {
    const { Emitter } = require('@socket.io/redis-emitter');
    const Redis = require('ioredis');
    const client = new Redis(process.env.REDIS_URL, { family: 0, maxRetriesPerRequest: 3 });
    client.on('error', (err) => logger.error({ err: err.message }, '[realtime] Redis emitter error'));
    emitter = new Emitter(client);
  }
  return emitter;
}

function target() {
  return localIo || getEmitter();
}

const userRoom = (userId) => `user_${userId}`;
const matchRoom = (matchId) => `match_${matchId}`;
const membersKey = (matchId) => `match:members:${matchId}`;
const MEMBERS_TTL_SECONDS = 5 * 60;

function run(label, fn) {
  const t = target();
  if (!t) {
    logger.warn(`[realtime] ${label} skipped: no socket server or Redis in this process`);
    return;
  }
  try {
    fn(t);
  } catch (err) {
    logger.warn({ err: err.message }, `[realtime] ${label} failed`);
  }
}

function emitToUser(userId, event, payload) {
  run('emitToUser', (t) => t.to(userRoom(userId)).emit(event, payload));
}

function disconnectUser(userId) {
  run('disconnectUser', (t) => t.in(userRoom(userId)).disconnectSockets(true));
}

/**
 * The two participants of an active match, or null. Cached because the chat
 * server checks it on every message; closeMatches clears it.
 */
async function getMatchMembers(matchId, db) {
  const cached = await sharedCache.get(membersKey(matchId));
  if (cached !== undefined) return cached;
  const { rows } = await db.query(
    `SELECT brand_id, influencer_id FROM matches WHERE id = $1 AND status = 'active'`,
    [matchId]
  );
  const members = rows[0] ? [rows[0].brand_id, rows[0].influencer_id] : null;
  await sharedCache.set(membersKey(matchId), members, MEMBERS_TTL_SECONDS);
  return members;
}

/**
 * Call after matches stop being active (block, unmatch, undo). Stops chat in
 * them immediately on every chat instance.
 */
async function closeMatches(matchIds) {
  if (!matchIds.length) return;
  await sharedCache.del(...matchIds.map(membersKey));
  for (const matchId of matchIds) {
    run('closeMatch', (t) => {
      t.to(matchRoom(matchId)).emit('match_closed', { matchId });
      t.in(matchRoom(matchId)).socketsLeave(matchRoom(matchId));
    });
  }
}

module.exports = {
  setServer,
  emitToUser,
  disconnectUser,
  getMatchMembers,
  closeMatches,
  userRoom,
  matchRoom,
  _reset: () => { localIo = null; emitter = undefined; },
};
