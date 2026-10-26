const { Expo } = require('expo-server-sdk');
const logger = require('./logger');

// Expo Client
const expo = new Expo();

// Redis config — only used if Redis is available
const hasRedis = !!(process.env.REDIS_URL || process.env.REDIS_HOST) && process.env.NODE_ENV !== 'test';

let connection = null;
let pushQueue = null;
let feedQueue = null;
let instagramQueue = null;
let platformStatsQueue = null;
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
    instagramQueue = new Queue('InstagramRefresh', { connection });
    platformStatsQueue = new Queue('PlatformStats', { connection });
  } catch (err) {
    logger.error({ err: err.message }, '[Queue] Failed to initialize BullMQ — jobs will run inline');
    pushQueue = null;
    feedQueue = null;
    instagramQueue = null;
    platformStatsQueue = null;
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

async function refreshInstagram() {
  const { refreshStaleInstagramStats } = require('../services/instagramRefresh');
  return refreshStaleInstagramStats();
}

// Daily follower refresh, overnight in India when nobody is browsing. Only
// scheduled where an Apify token exists, since every run is billed.
const INSTAGRAM_REFRESH_CRON = process.env.INSTAGRAM_REFRESH_CRON || '0 3 * * *';

async function scheduleInstagramRefresh() {
  if (!instagramQueue) return;
  if (!process.env.APIFY_API_TOKEN) {
    logger.warn('[Queue] APIFY_API_TOKEN not set — daily Instagram refresh disabled');
    return;
  }
  await instagramQueue.upsertJobScheduler(
    'instagram-refresh-daily',
    { pattern: INSTAGRAM_REFRESH_CRON, tz: 'Asia/Kolkata' },
    { name: 'refresh', opts: { removeOnComplete: 30, removeOnFail: 30 } },
  );
}

// 'sync' fetches one user's new accounts after a profile save; 'refresh' is
// the daily run over every stale account.
async function runPlatformStats(job) {
  const { syncUserPlatforms, refreshStalePlatformStats } = require('../services/platformStats');
  if (job.name === 'refresh') return refreshStalePlatformStats();
  return syncUserPlatforms(job.data.userId, job.data.role);
}

// Half an hour after the Instagram refresh, so the two don't overlap.
const PLATFORM_STATS_CRON = process.env.PLATFORM_STATS_CRON || '30 3 * * *';

async function schedulePlatformStatsRefresh() {
  if (!platformStatsQueue) return;
  if (!process.env.APIFY_API_TOKEN) {
    logger.warn('[Queue] APIFY_API_TOKEN not set — daily follower refresh disabled');
    return;
  }
  await platformStatsQueue.upsertJobScheduler(
    'platform-stats-daily',
    { pattern: PLATFORM_STATS_CRON, tz: 'Asia/Kolkata' },
    { name: 'refresh', opts: { removeOnComplete: 30, removeOnFail: 30 } },
  );
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
    ['InstagramRefresh', refreshInstagram, 1],
    ['PlatformStats', runPlatformStats, 2],
  ];
  for (const [name, processor, concurrency] of specs) {
    const worker = new Worker(name, processor, { connection: createConnection({ failFast: false }), concurrency });
    worker.on('failed', (job, err) => logger.error({ queue: name, jobId: job?.id, err: err.message }, '[BullMQ] job failed'));
    worker.on('error', (err) => logger.error({ queue: name, err: err.message }, '[BullMQ] worker error'));
    workers.push(worker);
  }
  logger.info('[Queue] Workers started: PushNotifications, FeedDecks, InstagramRefresh, PlatformStats');
  scheduleInstagramRefresh()
    .catch((err) => logger.error({ err: err.message }, '[Queue] Failed to schedule Instagram refresh'));
  schedulePlatformStatsRefresh()
    .catch((err) => logger.error({ err: err.message }, '[Queue] Failed to schedule follower refresh'));
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

/**
 * Fetches follower counts for a user's newly added or changed accounts in the
 * background. The fixed job id coalesces a burst of saves into one run; the
 * job reads what needs fetching from the profile when it runs.
 */
async function enqueuePlatformSync(userId, role) {
  if (platformStatsQueue) {
    await platformStatsQueue.add('sync', { userId, role }, {
      jobId: `pstats-${userId}`,
      delay: 3000,
      removeOnComplete: true,
      removeOnFail: 100,
    });
    return;
  }
  if (process.env.NODE_ENV === 'test' || !process.env.APIFY_API_TOKEN) return;
  setTimeout(() => {
    runPlatformStats({ name: 'sync', data: { userId, role } })
      .catch((err) => logger.warn({ err: err.message, userId }, '[Queue] inline follower sync failed'));
  }, 3000).unref();
}

/**
 * Job counts per queue, for the admin system page.
 *
 * Reports { configured: false } rather than throwing when Redis is absent, so
 * a health view still renders in dev and in test where queues never exist.
 * A queue that fails to answer reports its own error instead of failing the
 * whole page: a health endpoint that dies when something is unhealthy is
 * useless exactly when you need it.
 */
async function getQueueStats() {
  if (!hasRedis) return { configured: false, queues: [] };

  const entries = [['PushNotifications', pushQueue], ['FeedDecks', feedQueue], ['InstagramRefresh', instagramQueue], ['PlatformStats', platformStatsQueue]].filter(([, q]) => q);
  const queues = await Promise.all(entries.map(async ([name, queue]) => {
    try {
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
      return { name, ok: true, ...counts };
    } catch (err) {
      return { name, ok: false, error: err.message };
    }
  }));

  return { configured: true, queues };
}

module.exports = { pushQueue, enqueueFeedWarm, enqueuePlatformSync, startWorkers, stopWorkers, getQueueStats, hasRedis };
