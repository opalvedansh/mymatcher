const { Expo } = require('expo-server-sdk');
const logger = require('./logger');

// Expo Client
const expo = new Expo();

// Redis config — only used if Redis is available
const hasRedis = !!(process.env.REDIS_URL || process.env.REDIS_HOST) && process.env.NODE_ENV !== 'test';

let connection = null;
let pushQueue = null;
let feedQueue = null;
const workers = [];

// BullMQ needs its own connection with maxRetriesPerRequest: null, so it
// doesn't share state with the rate-limiter / socket adapter clients.
// Producers fail fast while Redis is down (offline queue off); workers wait.
function createConnection({ failFast }) {
  const IORedis = require('ioredis');
  const redisUrl = process.env.REDIS_URL;
  const opts = { maxRetriesPerRequest: null, family: 0, enableOfflineQueue: !failFast };
  const conn = redisUrl
    ? new IORedis(redisUrl, opts)
    : new IORedis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT) || 6379,
        ...opts,
      });
  // Prevents unhandled 'error' event crashes
  conn.on('error', (err) => logger.error({ err: err.message }, '[Queue] Redis connection error'));
  return conn;
}

if (hasRedis) {
  const { Queue } = require('bullmq');
  try {
    connection = createConnection({ failFast: true });
    pushQueue = new Queue('PushNotifications', { connection });
    feedQueue = new Queue('FeedDecks', { connection });
  } catch (err) {
    logger.error({ err: err.message }, '[Queue] Failed to initialize BullMQ — jobs will run inline');
    pushQueue = null;
    feedQueue = null;
  }
} else if (process.env.NODE_ENV !== 'test') {
  logger.warn('[Queue] Redis not available — background jobs will run inline in the API process.');
}

async function sendPush(job) {
  const { token, title, body, data } = job.data;

  if (!Expo.isExpoPushToken(token)) {
    logger.warn('[BullMQ] Invalid push token, skipping');
    return;
  }

  const tickets = await expo.sendPushNotificationsAsync([{ to: token, sound: 'default', title, body, data }]);
  const failed = tickets.filter((t) => t.status === 'error');
  if (failed.length) logger.warn({ errors: failed.map((t) => t.details?.error) }, '[BullMQ] Push rejected');
}

async function warmFeedDeck(job) {
  const { warm } = require('../services/feedDeck');
  await warm(job.data.userId, job.data.role);
}

/**
 * Starts the job workers in this process. The API runs them too unless
 * RUN_WORKERS=false (set that once `npm run worker` runs as its own service).
 */
function startWorkers() {
  if (!hasRedis || !connection || workers.length) return;
  const { Worker } = require('bullmq');
  const specs = [
    ['PushNotifications', sendPush, 5],
    ['FeedDecks', warmFeedDeck, 2],
  ];
  for (const [name, processor, concurrency] of specs) {
    const worker = new Worker(name, processor, { connection: createConnection({ failFast: false }), concurrency });
    worker.on('failed', (job, err) => logger.error({ queue: name, jobId: job?.id, err: err.message }, '[BullMQ] job failed'));
    worker.on('error', (err) => logger.error({ queue: name, err: err.message }, '[BullMQ] worker error'));
    workers.push(worker);
  }
  logger.info('[Queue] Workers started: PushNotifications, FeedDecks');
}

async function stopWorkers() {
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
}

/**
 * Rebuilds a user's feed deck in the background. The short delay plus a fixed
 * job id coalesces the burst of profile saves made during onboarding.
 */
async function enqueueFeedWarm(userId, role) {
  if (feedQueue) {
    await feedQueue.add('warm', { userId, role }, {
      jobId: `warm-${userId}`,
      delay: 2000,
      removeOnComplete: true,
      removeOnFail: 100,
      attempts: 2,
    });
    return;
  }
  if (process.env.NODE_ENV === 'test') return;
  // No queue: warm in this process after the response is sent.
  setTimeout(() => {
    warmFeedDeck({ data: { userId, role } })
      .catch((err) => logger.warn({ err: err.message, userId }, '[Queue] inline deck warm failed'));
  }, 2000).unref();
}

module.exports = { pushQueue, enqueueFeedWarm, startWorkers, stopWorkers };
