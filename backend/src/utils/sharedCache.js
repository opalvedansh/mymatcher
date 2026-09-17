const redisClient = require('../config/redis');
const { CacheStore } = require('../config/cache');
const logger = require('../config/logger');

/**
 * JSON key-value cache shared by every API instance through Redis.
 *
 * Falls back to a bounded in-process store when Redis is not configured or
 * not currently connected, so a Redis outage degrades to per-instance caching
 * instead of failing requests.
 */
const local = new CacheStore(60_000, 5_000);

const redisReady = () => redisClient?.status === 'ready';

async function get(key) {
  if (redisReady()) {
    try {
      const raw = await redisClient.get(key);
      return raw == null ? undefined : JSON.parse(raw);
    } catch (err) {
      logger.warn({ err: err.message, key }, '[sharedCache] get failed, using local cache');
    }
  }
  return local.get(key);
}

async function set(key, value, ttlSeconds) {
  if (redisReady()) {
    try {
      await redisClient.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      return;
    } catch (err) {
      logger.warn({ err: err.message, key }, '[sharedCache] set failed, using local cache');
    }
  }
  local.set(key, value, ttlSeconds * 1000);
}

async function del(...keys) {
  // Always clear the local copy too: it may have been filled during an outage.
  for (const key of keys) local.del(key);
  if (redisClient && keys.length) {
    try {
      await redisClient.del(...keys);
    } catch (err) {
      logger.warn({ err: err.message, keys }, '[sharedCache] del failed');
    }
  }
}

module.exports = { get, set, del, redisReady, _local: local };
