const db = require('../config/db');
const logger = require('../config/logger');
const { invalidateCache } = require('../middleware/cacheMiddleware');
const { isBlockedBetween } = require('../utils/blocks');

/**
 * Creator ratings of a brand.
 *
 * Only a creator the brand has actually matched with may rate it, and only
 * once — rating again replaces the earlier score. That is what keeps the
 * average on a brand profile from being something anyone can manufacture.
 */

// ─── GET /api/ratings/:brandId ───────────────────────────────────
async function getBrandRating(req, res, next) {
  try {
    const { brandId } = req.params;
    const viewerId = req.user.id;

    if (await isBlockedBetween(viewerId, brandId)) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { rows: [summary] } = await db.query(
      `SELECT
         COUNT(*)::int                       AS count,
         ROUND(AVG(score)::numeric, 1)       AS average,
         COUNT(*) FILTER (WHERE score >= 4)::int AS recommend_count
       FROM brand_ratings WHERE brand_id = $1`,
      [brandId]
    );

    // Whether the caller has rated this brand, so the UI can open on their score.
    const { rows: [mine] } = await db.query(
      'SELECT score, updated_at FROM brand_ratings WHERE brand_id = $1 AND influencer_id = $2',
      [brandId, viewerId]
    );

    // Rating is only open to someone who matched with the brand.
    const { rows: [match] } = await db.query(
      `SELECT id FROM matches
        WHERE brand_id = $1 AND influencer_id = $2
        ORDER BY matched_at DESC LIMIT 1`,
      [brandId, viewerId]
    );

    res.json({
      count: summary?.count ?? 0,
      average: summary?.average == null ? null : Number(summary.average),
      recommend_count: summary?.recommend_count ?? 0,
      my_score: mine?.score ?? null,
      can_rate: req.user.role === 'influencer' && !!match,
    });
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/ratings/:brandId ───────────────────────────────────
async function rateBrand(req, res, next) {
  try {
    const { brandId } = req.params;
    const { id: influencerId, role } = req.user;
    const score = req.body.score;

    if (role !== 'influencer') {
      return res.status(403).json({ error: 'Only creators can rate a brand' });
    }
    if (await isBlockedBetween(influencerId, brandId)) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { rows: [match] } = await db.query(
      `SELECT id FROM matches
        WHERE brand_id = $1 AND influencer_id = $2
        ORDER BY matched_at DESC LIMIT 1`,
      [brandId, influencerId]
    );
    if (!match) {
      return res.status(403).json({ error: 'You can only rate a brand you have matched with' });
    }

    await db.query(
      `INSERT INTO brand_ratings (brand_id, influencer_id, match_id, score)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (brand_id, influencer_id)
       DO UPDATE SET score = EXCLUDED.score, match_id = EXCLUDED.match_id, updated_at = NOW()`,
      [brandId, influencerId, match.id, score]
    );

    const { rows: [summary] } = await db.query(
      `SELECT COUNT(*)::int AS count, ROUND(AVG(score)::numeric, 1) AS average
         FROM brand_ratings WHERE brand_id = $1`,
      [brandId]
    );

    await invalidateCache(`cache:/api/profiles/${brandId}`);
    logger.info({ brandId, influencerId, score }, 'Brand rated');

    res.json({
      count: summary?.count ?? 0,
      average: summary?.average == null ? null : Number(summary.average),
      my_score: score,
      can_rate: true,
    });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/ratings/:brandId ────────────────────────────────
async function removeMyRating(req, res, next) {
  try {
    const { brandId } = req.params;
    const { rowCount } = await db.query(
      'DELETE FROM brand_ratings WHERE brand_id = $1 AND influencer_id = $2',
      [brandId, req.user.id]
    );
    await invalidateCache(`cache:/api/profiles/${brandId}`);
    res.json({ removed: rowCount });
  } catch (err) {
    next(err);
  }
}

module.exports = { getBrandRating, rateBrand, removeMyRating };
