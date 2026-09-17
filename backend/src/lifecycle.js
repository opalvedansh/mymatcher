const logger = require('./config/logger');

const BUILD_COMMIT = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'unknown';
const STARTED_AT = new Date().toISOString();

// `commit` reports which build is actually serving traffic. Without it a
// deploy cannot be told apart from a stale one, since auth-gated routes look
// identical from outside until you hold a valid token.
function healthBody(service) {
  return {
    status: 'ok',
    service,
    timestamp: new Date().toISOString(),
    commit: BUILD_COMMIT.slice(0, 7),
    startedAt: STARTED_AT,
  };
}

/**
 * Registers SIGTERM/SIGINT handling: runs each closer in order, then exits.
 * Closers are async functions; a failing one is logged and the rest still run.
 */
function onShutdown(closers) {
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    // Force close if connections hang
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000).unref();

    let failed = false;
    for (const close of closers) {
      try {
        await close();
      } catch (err) {
        failed = true;
        logger.error({ err: err.message }, 'Error during graceful shutdown');
      }
    }
    logger.info('Graceful shutdown finished');
    process.exit(failed ? 1 : 0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Shared closers for the Postgres pool and the main Redis client.
function closeDatabase() {
  return require('./config/db').pool.end();
}

async function closeRedis() {
  // Only close a client this process already created; requiring the module
  // here for the first time would open a new connection just to close it.
  const loaded = require.cache[require.resolve('./config/redis')];
  const redisClient = loaded?.exports;
  if (!redisClient) return;
  if (redisClient.status === 'ready') await redisClient.quit();
  else redisClient.disconnect();
}

module.exports = { healthBody, onShutdown, closeDatabase, closeRedis };
