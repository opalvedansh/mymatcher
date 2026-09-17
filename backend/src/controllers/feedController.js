const db = require('../config/db');
const { feedCache } = require('../config/cache');
const logger = require('../config/logger');
const { blockedBetween } = require('../utils/blocks');

// ─── Default Scoring weights ──────────────────────────────────────
const DEFAULT_WEIGHTS = {
  CATEGORY_OVERLAP: 40,
  BUDGET_FIT:       30,
  LOCATION_MATCH:   20,
  COMPLETENESS:     10,
};

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

// Distance is bucketed so exact positions can't be triangulated from the feed.
const PUBLIC_DISTANCE = 'CEIL(dist_km / 5.0) * 5 AS dist_km';

/**
 * GET /api/feed
 *
 * Returns scored, cursor-paginated candidates for the current user to swipe on.
 * Uses a optimized CTE to calculate distance and overlaps efficiently.
 *
 * Query params:
 *   limit        (default 10, max 50)
 *   cursor_score (optional, for pagination)
 *   cursor_id    (optional, for pagination)
 */
async function getFeed(req, res, next) {
  try {
    const { id: userId, role } = req.user;
    const limit       = Math.min(parseInt(req.query.limit || '10', 10), 50);
    const cursorScore = req.query.cursor_score ? parseFloat(req.query.cursor_score) : null;
    const cursorId    = req.query.cursor_id || null;

    // Fetch dynamic algorithm weights
    let WEIGHTS = feedCache.get('algorithm_weights');
    if (!WEIGHTS) {
      try {
        const { rows } = await db.query("SELECT value FROM admin_settings WHERE key = 'algorithm_weights'");
        WEIGHTS = sanitizeWeights(rows[0]?.value);
        feedCache.set('algorithm_weights', WEIGHTS);
      } catch (e) {
        // Fallback if table doesn't exist yet
        WEIGHTS = DEFAULT_WEIGHTS;
      }
    }
    const weightParams = [
      WEIGHTS.CATEGORY_OVERLAP, WEIGHTS.BUDGET_FIT, WEIGHTS.LOCATION_MATCH, WEIGHTS.COMPLETENESS,
    ];

    // ── Fetch current user's profile for scoring context ─────────
    const selfCacheKey = `feed-self:${userId}`;
    let myProfile = feedCache.get(selfCacheKey);

    if (!myProfile) {
      if (role === 'brand') {
        const { rows } = await db.query(
          `SELECT categories, budget_min, budget_max, location, lat, lng FROM brand_profiles WHERE user_id = $1`,
          [userId]
        );
        myProfile = rows[0] || null;
      } else {
        const { rows } = await db.query(
          `SELECT categories, price_min, price_max, location, lat, lng, platforms FROM influencer_profiles WHERE user_id = $1`,
          [userId]
        );
        myProfile = rows[0] || null;
      }
      if (myProfile) feedCache.set(selfCacheKey, myProfile);
    }

    let rows;

    if (role === 'brand') {
      // Brand sees influencers
      const myCategories = myProfile?.categories || [];
      const myBudgetMin  = myProfile?.budget_min  || 0;
      const myBudgetMax  = myProfile?.budget_max  || 0;
      const myLat        = myProfile?.lat          ?? null;
      const myLng        = myProfile?.lng          ?? null;
      const myLocation   = myProfile?.location    || '';

      ({ rows } = await db.query(
        `WITH Candidates AS (
           SELECT
             u.id, u.role, u.created_at,
             ip.name, ip.avatar_url, ip.cover_url, ip.bio, ip.categories,
             ip.location, ip.lat, ip.lng, ip.age, ip.gender, ip.platforms,
             ip.followers, ip.engagement_rate, ip.avg_views, ip.price_min, ip.price_max, ip.verified,
             
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
                price_min, price_max, verified, ${PUBLIC_DISTANCE}, relevance_score
         FROM Scored
         WHERE ($2::numeric IS NULL OR relevance_score < $2::numeric OR (relevance_score = $2::numeric AND id < $3::text))
         ORDER BY relevance_score DESC, id DESC
         LIMIT $10`,
        [userId, cursorScore, cursorId, myCategories, myBudgetMin, myBudgetMax, myLat, myLng, myLocation, limit, ...weightParams]
      ));

    } else {
      // Influencer sees brands
      const myCategories = myProfile?.categories || [];
      const myPriceMin   = myProfile?.price_min   || 0;
      const myPriceMax   = myProfile?.price_max   || 0;
      const myLat        = myProfile?.lat          ?? null;
      const myLng        = myProfile?.lng          ?? null;
      const myLocation   = myProfile?.location    || '';

      ({ rows } = await db.query(
        `WITH Candidates AS (
           SELECT
             u.id, u.role, u.created_at,
             bp.name, bp.logo_url, bp.cover_url, bp.bio, bp.categories,
             bp.location, bp.lat, bp.lng, bp.budget_min, bp.budget_max,
             bp.campaign_types, bp.vibes, bp.website, bp.verified,
             
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
                ${PUBLIC_DISTANCE}, relevance_score
         FROM Scored
         WHERE ($2::numeric IS NULL OR relevance_score < $2::numeric OR (relevance_score = $2::numeric AND id < $3::text))
         ORDER BY relevance_score DESC, id DESC
         LIMIT $10`,
        [userId, cursorScore, cursorId, myCategories, myPriceMin, myPriceMax, myLat, myLng, myLocation, limit, ...weightParams]
      ));
    }

    const nextCursorScore = rows.length === limit ? rows[rows.length - 1].relevance_score : null;
    const nextCursorId = rows.length === limit ? rows[rows.length - 1].id : null;

    res.json({
      data:        rows,
      count:       rows.length,
      next_cursor_score: nextCursorScore,
      next_cursor_id: nextCursorId,
      scoring: {
        weights: WEIGHTS,
        description: 'Relevance score out of 100. Uses cursor-based pagination and array intersections.',
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getFeed };
