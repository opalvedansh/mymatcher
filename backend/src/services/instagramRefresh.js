const db = require('../config/db');
const logger = require('../config/logger');
const { invalidateCache } = require('../middleware/cacheMiddleware');
const { scrapeInstagramProfiles } = require('./instagramSyncService');

// Followers move every day, but each scraped profile is billed, so a daily
// refresh with a per-run cap keeps the cost bounded as the creator base grows.
const STALE_AFTER_HOURS = Number(process.env.INSTAGRAM_REFRESH_STALE_HOURS) || 20;
const MAX_PER_RUN = Number(process.env.INSTAGRAM_REFRESH_LIMIT) || 500;
const BATCH_SIZE = 25;

// Profile saves store the handle as typed; the manual sync is what cleans it.
const cleanHandle = (handle) => handle.replace(/^@/, '').trim().toLowerCase();

/**
 * Re-scrapes follower count, engagement and average views for influencers
 * whose Instagram stats are older than STALE_AFTER_HOURS, oldest first.
 * Reels are left alone: re-hosting their thumbnails is the manual sync's job.
 *
 * @returns {Promise<{checked: number, updated: number}>}
 */
async function refreshStaleInstagramStats() {
  const { rows } = await db.query(
    `SELECT ip.user_id, ip.instagram_handle
       FROM influencer_profiles ip
       JOIN users u ON u.id = ip.user_id
      WHERE ip.instagram_handle IS NOT NULL
        AND ip.instagram_handle <> ''
        AND u.banned = false
        AND u.deleted_at IS NULL
        AND (ip.instagram_synced_at IS NULL
             OR ip.instagram_synced_at < NOW() - make_interval(hours => $1))
      ORDER BY ip.instagram_synced_at ASC NULLS FIRST
      LIMIT $2`,
    [STALE_AFTER_HOURS, MAX_PER_RUN]
  );

  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    let byHandle;
    try {
      byHandle = await scrapeInstagramProfiles(batch.map((r) => cleanHandle(r.instagram_handle)));
    } catch (err) {
      // One failed run shouldn't cost the batches after it.
      logger.error({ err: err.message, batchStart: i }, '[InstagramRefresh] scrape failed');
      continue;
    }

    for (const { user_id: userId, instagram_handle: handle } of batch) {
      const stats = byHandle.get(cleanHandle(handle));
      // Private, renamed or deleted accounts keep their last known stats.
      if (!stats) continue;
      // The handle check skips a creator who switched accounts mid-run.
      const { rowCount } = await db.query(
        `UPDATE influencer_profiles SET
           followers           = $1,
           engagement_rate     = $2,
           avg_views           = $3,
           instagram_synced_at = NOW()
         WHERE user_id = $4 AND instagram_handle = $5`,
        [stats.followers, stats.engagement_rate, stats.avg_views, userId, handle]
      );
      if (rowCount) {
        updated++;
        await invalidateCache(`cache:/api/profiles/${userId}`);
      }
    }
  }

  logger.info({ checked: rows.length, updated }, '[InstagramRefresh] run complete');
  return { checked: rows.length, updated };
}

module.exports = { refreshStaleInstagramStats };
