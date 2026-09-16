const logger = require('./logger');

let redisClient = null;

// Only create a real Redis client if REDIS_URL is explicitly set,
// or if we're NOT in development/test mode.
// This prevents the app from crashing when Redis isn't installed locally.
const shouldUseRedis =
  process.env.NODE_ENV === 'test'
    ? false
    : !!process.env.REDIS_URL;

if (process.env.NODE_ENV === 'test') {
  const Redis = require('ioredis-mock');
  redisClient = new Redis();
} else if (shouldUseRedis) {
  const Redis = require('ioredis');
  redisClient = new Redis(process.env.REDIS_URL, {
    family: 0,             // support Railway's IPv6 private networking
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false, // don't queue commands when disconnected
    // Keep reconnecting with capped backoff; giving up would leave the process
    // without Redis until the next restart.
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });

  redisClient.on('error', (err) => {
    logger.error('Redis connection error:', err.message);
  });

  redisClient.on('connect', () => {
    logger.info('Redis connected successfully');
  });
} else {
  // No Redis in development — log a warning once and export null.
  // Rate limiters and socket adapter will gracefully fall back to in-memory.
  logger.warn('Redis not configured — using in-memory fallback for rate limiting. Set REDIS_URL for production.');
}

module.exports = redisClient;
