const crypto = require('crypto');
const { RedisStore } = require('rate-limit-redis');
const redisClient = require('./redis');

// The store loads its Lua scripts once, at startup, and keeps the result. The
// client has no offline queue, so that load fails whenever Redis is not
// connected yet, and every later request would fail with it. A failed load
// instead returns the script's SHA1 (what Redis would have answered); the
// first EVALSHA then gets NOSCRIPT and the store reloads the script itself.
function sendRedisCommand(...args) {
  const [command, subcommand, script] = args;
  const isScriptLoad = String(command).toUpperCase() === 'SCRIPT' && String(subcommand).toUpperCase() === 'LOAD';
  const result = redisClient.call(...args);
  if (!isScriptLoad) return result;
  return result.catch(() => crypto.createHash('sha1').update(script).digest('hex'));
}

/**
 * Shared counter store so a limit holds across every API instance.
 * Returns undefined (express-rate-limit's in-memory store) without Redis.
 */
function redisStore(prefix) {
  if (!redisClient || process.env.NODE_ENV === 'test') return undefined;
  return new RedisStore({ sendCommand: sendRedisCommand, prefix });
}

// With Redis down, let requests through rather than failing all of them.
const limiterDefaults = { passOnStoreError: true, standardHeaders: true, legacyHeaders: false };

module.exports = { redisStore, limiterDefaults, sendRedisCommand };
