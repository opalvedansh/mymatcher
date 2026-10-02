const db = require('../config/db');
const logger = require('../config/logger');
const { blockedBetween, isBlockedBetween } = require('../utils/blocks');

/**
 * LinkedIn reviews of a creator, written by brands.
 *
 * A creator cannot add one about themselves; only a brand the creator has
 * actually matched with may, once — reviewing again edits it. Each links to
 * LinkedIn so other brands can check who wrote it. Gated the same way as
 * brand ratings (ratingController).
 *
 * Served apart from GET /api/profiles/:id because that response is cached and
 * shared by every viewer, while `can_review` and `my_review` depend on who asks.
 */

const MAX_LISTED = 50;

// Reviews by banned or deleted brands, or by a brand either side has blocked,
// are left out of both the list and the count.
const VISIBLE = `
  FROM creator_reviews r
  JOIN users u ON u.id = r.brand_id AND u.banned = false AND u.deleted_at IS NULL
  LEFT JOIN brand_profiles bp ON bp.user_id = r.brand_id
  WHERE r.influencer_id = $1
    AND NOT ${blockedBetween('$2', 'r.brand_id')}`;

async function findMatch(brandId, influencerId) {
  const { rows: [match] } = await db.query(
    `SELECT id FROM matches
      WHERE brand_id = $1 AND influencer_id = $2
      ORDER BY matched_at DESC LIMIT 1`,
    [brandId, influencerId]
  );
  return match || null;
}

async function loadReviews(creatorId, viewer) {
  const [list, summary, mine, match] = await Promise.all([
    db.query(
      `SELECT r.id, r.brand_id, r.quote, r.reviewer_name, r.reviewer_title, r.linkedin_url,
              r.created_at, r.updated_at,
              bp.name AS brand_name, bp.logo_url AS brand_logo_url, bp.verified AS brand_verified
         ${VISIBLE}
        ORDER BY r.updated_at DESC
        LIMIT ${MAX_LISTED}`,
      [creatorId, viewer.id]
    ),
    db.query(`SELECT COUNT(*)::int AS count ${VISIBLE}`, [creatorId, viewer.id]),
    viewer.role === 'brand'
      ? db.query(
        `SELECT quote, reviewer_name, reviewer_title, linkedin_url, updated_at
           FROM creator_reviews WHERE influencer_id = $1 AND brand_id = $2`,
        [creatorId, viewer.id]
      )
      : { rows: [] },
    viewer.role === 'brand' ? findMatch(viewer.id, creatorId) : null,
  ]);

  return {
    reviews: list.rows.map((r) => ({ ...r, brand_verified: !!r.brand_verified })),
    count: summary.rows[0]?.count ?? 0,
    my_review: mine.rows[0] ?? null,
    can_review: viewer.role === 'brand' && !!match,
  };
}

// ─── GET /api/reviews/:creatorId ─────────────────────────────────
async function getCreatorReviews(req, res, next) {
  try {
    const { creatorId } = req.params;
    if (await isBlockedBetween(req.user.id, creatorId)) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(await loadReviews(creatorId, req.user));
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/reviews/:creatorId ─────────────────────────────────
async function reviewCreator(req, res, next) {
  try {
    const { creatorId } = req.params;
    const { id: brandId, role } = req.user;
    // The route has already checked and normalised these.
    const { quote, reviewer_name: reviewerName, reviewer_title: reviewerTitle, linkedin_url: linkedinUrl } = req.body;

    if (role !== 'brand') {
      return res.status(403).json({ error: 'Only a brand can add a LinkedIn review of a creator' });
    }
    if (await isBlockedBetween(brandId, creatorId)) {
      return res.status(404).json({ error: 'User not found' });
    }

    const match = await findMatch(brandId, creatorId);
    if (!match) {
      return res.status(403).json({ error: 'You can only review a creator you have matched with' });
    }

    await db.query(
      `INSERT INTO creator_reviews
         (influencer_id, brand_id, match_id, quote, reviewer_name, reviewer_title, linkedin_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (influencer_id, brand_id)
       DO UPDATE SET quote = EXCLUDED.quote, reviewer_name = EXCLUDED.reviewer_name,
                     reviewer_title = EXCLUDED.reviewer_title, linkedin_url = EXCLUDED.linkedin_url,
                     match_id = EXCLUDED.match_id, updated_at = NOW()`,
      [creatorId, brandId, match.id, quote, reviewerName, reviewerTitle || null, linkedinUrl]
    );
    logger.info({ creatorId, brandId }, 'Creator reviewed');

    res.json(await loadReviews(creatorId, req.user));
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/reviews/:creatorId ──────────────────────────────
async function removeMyReview(req, res, next) {
  try {
    const { creatorId } = req.params;
    await db.query(
      'DELETE FROM creator_reviews WHERE influencer_id = $1 AND brand_id = $2',
      [creatorId, req.user.id]
    );
    res.json(await loadReviews(creatorId, req.user));
  } catch (err) {
    next(err);
  }
}

module.exports = { getCreatorReviews, reviewCreator, removeMyReview };
