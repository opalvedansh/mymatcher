const db = require('../../config/db');
const logger = require('../../config/logger');
const { invalidateCache } = require('../../middleware/cacheMiddleware');
const sharedCache = require('../../utils/sharedCache');
const { FETCHERS } = require('./fetchers');

// Follower counts are refreshed daily. Each scraped profile is billed, so a
// run is capped, and a handle that just failed isn't retried for an hour
// (otherwise every profile save could start another paid run).
const STALE_AFTER_HOURS = Number(process.env.PLATFORM_STATS_STALE_HOURS) || 20;
const MAX_PER_RUN = Number(process.env.PLATFORM_STATS_LIMIT) || 1000;
const RETRY_AFTER_SECONDS = 60 * 60;

const TABLES = { brand: 'brand_profiles', influencer: 'influencer_profiles' };

/** True when the stored count wasn't fetched for this exact handle. */
const needsSync = (entry, handle) =>
  !entry || entry.source !== 'synced' || entry.handle !== handle;

// A creator's Instagram belongs to the Instagram sync (influencer_profiles.followers).
const ownedElsewhere = (role, platform) => role === 'influencer' && platform === 'instagram';

/**
 * Stores a fetched count, but only while the profile still lists the handle it
 * was fetched for: a user who changed accounts mid-fetch keeps the new one.
 */
async function saveCount({ userId, role, platform, handle }, count) {
  const entry = { count, source: 'synced', updated_at: new Date().toISOString(), handle };
  const { rowCount } = await db.query(
    `UPDATE ${TABLES[role]}
        SET platform_followers = platform_followers || jsonb_build_object($2::text, $3::jsonb)
      WHERE user_id = $1 AND platform_handles->>$2 = $4`,
    [userId, platform, JSON.stringify(entry), handle]
  );
  return rowCount > 0;
}

/**
 * Fetches and stores counts for `targets` ({ userId, role, platform, handle }),
 * batching each platform's handles into as few scraper runs as it allows.
 * Platforms run side by side; a failed run only costs its own batch.
 */
async function fetchAndSave(targets) {
  const byPlatform = new Map();
  for (const t of targets) {
    if (!FETCHERS[t.platform]) continue;
    if (!byPlatform.has(t.platform)) byPlatform.set(t.platform, []);
    byPlatform.get(t.platform).push(t);
  }

  const touchedUsers = new Set();
  let updated = 0;

  await Promise.all([...byPlatform].map(async ([platform, group]) => {
    const fetcher = FETCHERS[platform];
    const handles = [...new Set(group.map((t) => t.handle))];
    for (let i = 0; i < handles.length; i += fetcher.batchSize) {
      const batch = handles.slice(i, i + fetcher.batchSize);
      let counts;
      try {
        counts = await fetcher.fetch(batch);
      } catch (err) {
        logger.error({ platform, err: err.message, batchSize: batch.length }, '[PlatformStats] fetch failed');
        continue;
      }
      for (const t of group) {
        if (!batch.includes(t.handle) || !counts.has(t.handle)) continue;
        if (await saveCount(t, counts.get(t.handle))) {
          updated++;
          touchedUsers.add(t.userId);
        }
      }
    }
  }));

  await Promise.all([...touchedUsers].map((id) => invalidateCache(`cache:/api/profiles/${id}`)));
  return { checked: targets.length, updated };
}

/**
 * Fetches counts for a user's accounts that have never been fetched, or were
 * fetched for a handle they have since changed. Run after a profile save.
 */
async function syncUserPlatforms(userId, role) {
  const table = TABLES[role];
  if (!table) return { checked: 0, updated: 0 };
  const { rows: [row] } = await db.query(
    `SELECT platform_handles, platform_followers FROM ${table} WHERE user_id = $1`,
    [userId]
  );
  if (!row) return { checked: 0, updated: 0 };

  const targets = [];
  for (const [platform, handle] of Object.entries(row.platform_handles || {})) {
    if (ownedElsewhere(role, platform) || !FETCHERS[platform]) continue;
    if (!needsSync(row.platform_followers?.[platform], handle)) continue;
    const triedKey = `pstats:tried:${userId}:${platform}:${handle}`;
    if (await sharedCache.get(triedKey)) continue;
    await sharedCache.set(triedKey, true, RETRY_AFTER_SECONDS);
    targets.push({ userId, role, platform, handle });
  }

  const result = await fetchAndSave(targets);
  logger.info({ userId, ...result }, '[PlatformStats] user sync complete');
  return result;
}

/**
 * The daily refresh: every listed account whose count is missing, belongs to
 * an old handle, or is older than STALE_AFTER_HOURS, oldest first.
 */
async function refreshStalePlatformStats() {
  const { rows } = await db.query(
    `WITH accounts AS (
       SELECT 'brand' AS role, p.user_id, h.key AS platform, h.value AS handle,
              p.platform_followers -> h.key AS entry
         FROM brand_profiles p
         JOIN users u ON u.id = p.user_id
        CROSS JOIN LATERAL jsonb_each_text(p.platform_handles) h
        WHERE u.banned = false AND u.deleted_at IS NULL
       UNION ALL
       SELECT 'influencer', p.user_id, h.key, h.value, p.platform_followers -> h.key
         FROM influencer_profiles p
         JOIN users u ON u.id = p.user_id
        CROSS JOIN LATERAL jsonb_each_text(p.platform_handles) h
        WHERE u.banned = false AND u.deleted_at IS NULL AND h.key <> 'instagram'
     )
     SELECT role, user_id, platform, handle FROM accounts
      WHERE entry IS NULL
         OR entry->>'source' IS DISTINCT FROM 'synced'
         OR entry->>'handle' IS DISTINCT FROM handle
         OR (entry->>'updated_at')::timestamptz < NOW() - make_interval(hours => $1)
      ORDER BY (entry->>'updated_at') ASC NULLS FIRST
      LIMIT $2`,
    [STALE_AFTER_HOURS, MAX_PER_RUN]
  );

  const result = await fetchAndSave(rows.map((r) => ({
    userId: r.user_id, role: r.role, platform: r.platform, handle: r.handle,
  })));
  logger.info(result, '[PlatformStats] daily refresh complete');
  return result;
}

module.exports = { syncUserPlatforms, refreshStalePlatformStats, needsSync };
