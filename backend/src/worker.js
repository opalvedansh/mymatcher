require('dotenv').config();

/**
 * Standalone background worker (`npm run worker`): push notifications and
 * feed deck precomputation. Run it as its own service and set
 * RUN_WORKERS=false on the API so job load never slows down requests.
 */
const logger = require('./config/logger');
const { startWorkers, stopWorkers } = require('./config/queue');
const { onShutdown, closeDatabase, closeRedis } = require('./lifecycle');

if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
  logger.error('REDIS_URL is required for the worker service');
  process.exit(1);
}

startWorkers();
logger.info('⚙️  Matcherc worker running');

onShutdown([stopWorkers, closeDatabase, closeRedis]);
