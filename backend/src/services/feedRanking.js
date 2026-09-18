const db = require('../config/db');
const sharedCache = require('../utils/sharedCache');
const { blockedBetween } = require('../utils/blocks');

// ─── Default Scoring weights ──────────────────────────────────────
const DEFAULT_WEIGHTS = {
  CATEGORY_OVERLAP: 40,
  BUDGET_FIT:       30,
  LOCATION_MATCH:   20,
  COMPLETENESS:     10,
};

const WEIGHTS_KEY = 'feed:weights';
const WEIGHTS_TTL_SECONDS = 60;
const VIEWER_TTL_SECONDS = 5 * 60;
const viewerKey = (userId) => `feed:viewer:${userId}`;

// Stored weights are admin-editable JSON, so anything non-numeric falls back
// to the default rather than breaking the feed query for every user.
function sanitizeWeights(raw) {
  const weights = {};
  for (const [key, fallback] of Object.entries(DEFAULT_WEIGHTS)) {
    const value = Number(raw?.[key]);
    weights[key] = Number.isFinite(value) ? value : fallback;
  }
  return weights;
}

async function loadWeights() {
  let weights = await sharedCache.get(WEIGHTS_KEY);
  if (weights) return weights;
  try {
    const { rows } = await db.query("SELECT value FROM admin_settings WHERE key = 'algorithm_weights'");
    weights = sanitizeWeights(rows[0]?.value);
  } catch {
    // Fallback if table doesn't exist yet
    return DEFAULT_WEIGHTS;
  }
  await sharedCache.set(WEIGHTS_KEY, weights, WEIGHTS_TTL_SECONDS);
  return weights;
}

// The viewer's own profile: what candidates are scored against.
async function loadViewer(userId, role) {
  let viewer = await sharedCache.get(viewerKey(userId));
  if (viewer && viewer.role === role) return viewer.profile;

  const { rows } = role === 'brand'
    ? await db.query(
      `SELECT categories, budget_min, budget_max, location, lat, lng FROM brand_profiles WHERE user_id = $1`,
      [userId]
    )
    : await db.query(
      `SELECT categories, price_min, price_max, location, lat, lng, platforms FROM influencer_profiles WHERE user_id = $1`,
      [userId]
    );
  const profile = rows[0] || null;
  if (profile) await sharedCache.set(viewerKey(userId), { role, profile }, VIEWER_TTL_SECONDS);
  return profile;
}

/** Everything a ranking query needs about the viewer, loaded once per request. */
async function loadContext(userId, role) {
  const [weights, profile] = await Promise.all([loadWeights(), loadViewer(userId, role)]);
  return { userId, role, weights, profile, weightsHash: JSON.stringify(weights) };
}

function invalidateViewer(userId) {
  return sharedCache.del(viewerKey(userId));
}

function invalidateWeights() {
  return sharedCache.del(WEIGHTS_KEY);
}

// Distance is bucketed so exact positions can't be triangulated from the feed.
const PUBLIC_DISTANCE = 'CEIL(dist_km / 5.0) * 5 AS dist_km';

// Ordering uses the C collation so it matches plain string comparison in JS,
// which the feed deck relies on to find a cursor's position.
const ORDER = 'ORDER BY relevance_score DESC, id COLLATE "C" DESC';
const AFTER_CURSOR = '($2::numeric IS NULL OR relevance_score < $2::numeric OR (relevance_score = $2::numeric AND id COLLATE "C" < $3::text))';

function influencerSql(idFilter) {
  return `WITH Candidates AS (
     SELECT
       u.id, u.role, u.created_at,
       ip.name, ip.avatar_url, ip.cover_url, ip.bio, ip.categories,
       ip.location, ip.lat, ip.lng, ip.age, ip.gender, ip.platforms,
       ip.followers, ip.engagement_rate, ip.avg_views, ip.price_min, ip.price_max, ip.verified,
       -- Brands the creator listed themselves; the card shows these instead of stock logos.
       ip.worked_with,
       -- Only an Instagram sync writes follower figures. Without one, whatever
       -- sits in those columns was put there by hand and is not a measurement.
       (ip.instagram_synced_at IS NOT NULL) AS stats_verified,

       CASE
         WHEN $7::numeric IS NOT NULL AND $8::numeric IS NOT NULL AND ip.location_geog IS NOT NULL
         THEN ST_Distance(ip.location_geog, ST_SetSRID(ST_MakePoint($8::numeric, $7::numeric), 4326)) / 1000.0
         ELSE NULL
       END AS dist_km,

       (
         SELECT COUNT(*)
         FROM unnest(ip.categories) AS cat1
         JOIN unnest($4::text[]) AS cat2 ON cat1 = cat2
       ) AS cat_overlap_count,

       array_length(ip.categories, 1) AS their_cat_len

     FROM users u
     JOIN influencer_profiles ip ON ip.user_id = u.id
     WHERE u.role = 'influencer'
       AND u.id <> $1
       -- Without these a banned or deleted account keeps being dealt into
       -- everyone else's deck: endSessions only drops their own connections.
       AND u.banned = false
       AND u.deleted_at IS NULL
       ${idFilter}
       AND NOT EXISTS (
         SELECT 1 FROM swipes s WHERE s.swiper_id = $1 AND s.swiped_id = u.id
       )
       AND NOT ${blockedBetween('$1', 'u.id')}
       AND ($7::numeric IS NULL OR $8::numeric IS NULL
            OR ip.location_geog IS NULL
            OR ST_DWithin(ip.location_geog, ST_SetSRID(ST_MakePoint($8::numeric, $7::numeric), 4326), 500000))
   ),
   Scored AS (
     SELECT *,
       id AS user_id,
       ROUND(CAST(
         -- 1. Category overlap (40 pts)
         $11::numeric * (
           CASE
             WHEN their_cat_len IS NULL OR their_cat_len = 0 THEN 0.5
             ELSE LEAST(cat_overlap_count::numeric / their_cat_len::numeric, 1.0)
           END
         )
         -- 2. Budget ↔ price fit (30 pts)
         + $12::numeric * (
           CASE
             WHEN $5 = 0 AND $6 = 0 THEN 0.5
             WHEN price_min = 0 AND price_max = 0 THEN 0.5
             WHEN $6 >= price_max AND $5 <= price_min THEN 1.0
             WHEN GREATEST($5, price_min) <= LEAST($6, price_max) THEN 0.5
             ELSE 0
           END
         )
         -- 3. Location proximity (20 pts)
         + $13::numeric * (
           CASE
             WHEN dist_km IS NOT NULL THEN (
               CASE WHEN dist_km < 50 THEN 1.0 WHEN dist_km < 200 THEN 0.67 WHEN dist_km < 500 THEN 0.33 ELSE 0 END
             )
             WHEN $9 = '' OR location IS NULL THEN 0.3
             WHEN LOWER(TRIM(location)) = LOWER(TRIM($9)) THEN 1.0
             ELSE 0
           END
         )
         -- 4. Profile completeness (10 pts)
         + $14::numeric * (
           CASE WHEN name IS NOT NULL AND bio IS NOT NULL AND avatar_url IS NOT NULL THEN 1.0 WHEN name IS NOT NULL THEN 0.5 ELSE 0 END
         )
       AS NUMERIC), 2) AS relevance_score
     FROM Candidates
   )
   SELECT id, user_id, role, created_at, name, avatar_url, cover_url, bio, categories,
          location, age, gender, platforms, followers, engagement_rate, avg_views,
          price_min, price_max, verified, worked_with, stats_verified, ${PUBLIC_DISTANCE}, relevance_score
   FROM Scored
   WHERE ${AFTER_CURSOR}
   ${ORDER}
   LIMIT $10`;
}

function brandSql(idFilter) {
  return `WITH Candidates AS (
     SELECT
       u.id, u.role, u.created_at,
       bp.name, bp.logo_url, bp.cover_url, bp.bio, bp.categories,
       bp.location, bp.lat, bp.lng, bp.budget_min, bp.budget_max,
       bp.campaign_types, bp.vibes, bp.website, bp.verified,
       bp.deliverable_reels, bp.deliverable_stories, bp.deliverable_posts,
       -- What creators who matched this brand scored it, for the swipe card.
       (SELECT ROUND(AVG(score)::numeric, 1) FROM brand_ratings r WHERE r.brand_id = bp.user_id) AS rating_avg,
       (SELECT COUNT(*)::int          FROM brand_ratings r WHERE r.brand_id = bp.user_id) AS rating_count,

       CASE
         WHEN $7::numeric IS NOT NULL AND $8::numeric IS NOT NULL AND bp.location_geog IS NOT NULL
         THEN ST_Distance(bp.location_geog, ST_SetSRID(ST_MakePoint($8::numeric, $7::numeric), 4326)) / 1000.0
         ELSE NULL
       END AS dist_km,

       (
         SELECT COUNT(*)
         FROM unnest(bp.categories) AS cat1
         JOIN unnest($4::text[]) AS cat2 ON cat1 = cat2
       ) AS cat_overlap_count,

       array_length(bp.categories, 1) AS their_cat_len

     FROM users u
     JOIN brand_profiles bp ON bp.user_id = u.id
     WHERE u.role = 'brand'
       AND u.id <> $1
       AND u.banned = false
       AND u.deleted_at IS NULL
       ${idFilter}
       AND NOT EXISTS (
         SELECT 1 FROM swipes s WHERE s.swiper_id = $1 AND s.swiped_id = u.id
       )
       AND NOT ${blockedBetween('$1', 'u.id')}
       AND ($7::numeric IS NULL OR $8::numeric IS NULL
            OR bp.location_geog IS NULL
            OR ST_DWithin(bp.location_geog, ST_SetSRID(ST_MakePoint($8::numeric, $7::numeric), 4326), 500000))
   ),
   Scored AS (
     SELECT *,
       id AS user_id,
       ROUND(CAST(
         -- 1. Category overlap (40 pts)
         $11::numeric * (
           CASE
             WHEN their_cat_len IS NULL OR their_cat_len = 0 THEN 0.5
             ELSE LEAST(cat_overlap_count::numeric / their_cat_len::numeric, 1.0)
           END
         )
         -- 2. Budget ↔ price fit (30 pts)
         + $12::numeric * (
           CASE
             WHEN budget_min = 0 AND budget_max = 0 THEN 0.5
             WHEN $5 = 0 AND $6 = 0 THEN 0.5
             WHEN budget_max >= $6 AND budget_min <= $5 THEN 1.0
             WHEN GREATEST(budget_min, $5) <= LEAST(budget_max, $6) THEN 0.5
             ELSE 0
           END
         )
         -- 3. Location proximity (20 pts)
         + $13::numeric * (
           CASE
             WHEN dist_km IS NOT NULL THEN (
               CASE WHEN dist_km < 50 THEN 1.0 WHEN dist_km < 200 THEN 0.67 WHEN dist_km < 500 THEN 0.33 ELSE 0 END
             )
             WHEN $9 = '' OR location IS NULL THEN 0.3
             WHEN LOWER(TRIM(location)) = LOWER(TRIM($9)) THEN 1.0
             ELSE 0
           END
         )
         -- 4. Profile completeness (10 pts)
         + $14::numeric * (
           CASE WHEN name IS NOT NULL AND bio IS NOT NULL AND logo_url IS NOT NULL THEN 1.0 WHEN name IS NOT NULL THEN 0.5 ELSE 0 END
         )
       AS NUMERIC), 2) AS relevance_score
     FROM Candidates
   )
   SELECT id, user_id, role, created_at, name, logo_url, cover_url, bio, categories,
          location, budget_min, budget_max, campaign_types, vibes, website, verified,
          deliverable_reels, deliverable_stories, deliverable_posts, rating_avg, rating_count,
          ${PUBLIC_DISTANCE}, relevance_score
   FROM Scored
   WHERE ${AFTER_CURSOR}
   ${ORDER}
   LIMIT $10`;
}

/**
 * Scores the viewer's candidates, best first.
 *
 * @param ctx     from loadContext
 * @param cursor  optional { s: score, id } — only rows ranked after it
 * @param limit   max rows
 * @param ids     optional — score only these users (deck hydration)
 */
async function scoreCandidates(ctx, { cursor = null, limit, ids = null }) {
  const p = ctx.profile || {};
  // Brands see influencers and compare their budget; influencers see brands
  // and compare their price.
  const isBrand = ctx.role === 'brand';
  const low  = (isBrand ? p.budget_min : p.price_min) || 0;
  const high = (isBrand ? p.budget_max : p.price_max) || 0;
  const w = ctx.weights;

  const params = [
    ctx.userId, cursor ? cursor.s : null, cursor ? cursor.id : null,
    p.categories || [], low, high, p.lat ?? null, p.lng ?? null, p.location || '',
    limit,
    w.CATEGORY_OVERLAP, w.BUDGET_FIT, w.LOCATION_MATCH, w.COMPLETENESS,
  ];
  let idFilter = '';
  if (ids) {
    params.push(ids);
    idFilter = 'AND u.id = ANY($15::text[])';
  }

  const sql = isBrand ? influencerSql(idFilter) : brandSql(idFilter);
  const { rows } = await db.query(sql, params);
  return rows;
}

module.exports = {
  DEFAULT_WEIGHTS,
  sanitizeWeights,
  loadContext,
  invalidateViewer,
  invalidateWeights,
  scoreCandidates,
};
