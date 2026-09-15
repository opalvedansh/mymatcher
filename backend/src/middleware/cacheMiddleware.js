const redisClient = require('../config/redis');
const logger = require('../config/logger');

/**
 * Express middleware to cache responses in Redis.
 * Gracefully skips caching when Redis is not available.
 * @param {number} durationInSeconds - How long to cache the response.
 */
function cache(durationInSeconds) {
  return async (req, res, next) => {
    // Skip caching entirely if Redis is not configured
    if (!redisClient) return next();

    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Build a cache key based on the URL
    const key = `cache:${req.originalUrl || req.url}`;

    try {
      const cachedResponse = await redisClient.get(key);
      
      if (cachedResponse) {
        // Cache hit! Return the JSON directly
        res.setHeader('X-Cache', 'HIT');
        return res.json(JSON.parse(cachedResponse));
      }

      // Cache miss. We must intercept the res.json() to save the response
      res.setHeader('X-Cache', 'MISS');
      const originalJson = res.json;

      res.json = function (body) {
        // Restore original res.json so it doesn't loop
        res.json = originalJson;

        // Save to Redis (fire and forget)
        redisClient.setex(key, durationInSeconds, JSON.stringify(body)).catch((err) => {
          logger.error('[Cache] Failed to save to Redis:', err.message);
        });

        // Send the response
        return res.json(body);
      };

      next();
    } catch (err) {
      logger.error('[Cache] Redis error in middleware:', err.message);
      next(); // If Redis fails, just proceed without caching
    }
  };
}

/**
 * Utility to manually invalidate a cache key (or pattern).
 * No-ops when Redis is not available.
 */
async function invalidateCache(pattern) {
  if (!redisClient) return;
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(...keys);
      logger.debug(`[Cache] Invalidated keys matching: ${pattern}`);
    }
  } catch (err) {
    logger.error('[Cache] Failed to invalidate cache:', err.message);
  }
}

module.exports = { cache, invalidateCache };
