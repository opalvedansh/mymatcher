const redisClient = require('../config/redis');
const logger = require('../config/logger');
const realtime = require('../realtime');

/**
 * Makes account-state changes (ban, unban, deletion) take effect now instead
 * of when the 5-minute auth cache expires, and by default drops the users'
 * live chat connections on every chat instance.
 */
async function endSessions(userIds, { disconnect = true } = {}) {
  if (!userIds.length) return;
  if (redisClient) {
    try {
      await redisClient.del(...userIds.map((id) => `user:session:${id}`));
    } catch (err) {
      logger.warn({ err: err.message }, 'Could not clear cached sessions');
    }
  }
  if (disconnect) {
    for (const id of userIds) realtime.disconnectUser(id);
  }
}

module.exports = { endSessions };
