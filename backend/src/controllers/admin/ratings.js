const db = require('../../config/db');
const { invalidateCache } = require('../../middleware/cacheMiddleware');
const { encodeCursor, decodeCursor, clampLimit } = require('../../utils/adminQuery');

// ─── GET /api/admin/ratings ──────────────────────────────────────
async function listRatings(req, res, next) {
  try {
    const limit = clampLimit(req.query.limit, 50, 100);
    const where = [];
    const params = [];
    const add = (v) => `$${params.push(v)}`;

    if (req.query.brand_id) where.push(`r.brand_id = ${add(req.query.brand_id)}`);
    if (req.query.influencer_id) where.push(`r.influencer_id = ${add(req.query.influencer_id)}`);
    if (req.query.score) where.push(`r.score = ${add(Number(req.query.score))}`);
    if (req.query.from) where.push(`r.created_at >= ${add(req.query.from)}::date`);
    if (req.query.to) where.push(`r.created_at < (${add(req.query.to)}::date + 1)`);

    const cursor = decodeCursor(req.query.cursor);
    if (cursor) {
      where.push(`(r.created_at, r.id::text) < ($${params.push(cursor.ts)}::timestamptz, $${params.push(cursor.id)})`);
    }

    const { rows } = await db.query(
      `SELECT r.id, r.brand_id, r.influencer_id, r.match_id, r.score, r.created_at, r.updated_at,
              bp.name AS brand_name, ip.name AS influencer_name
         FROM brand_ratings r
         LEFT JOIN brand_profiles      bp ON bp.user_id = r.brand_id
         LEFT JOIN influencer_profiles ip ON ip.user_id = r.influencer_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $${params.push(limit + 1)}`,
      params
    );

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    res.json({
      data,
      next_cursor: hasMore ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id) : null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/admin/ratings/suspicious ───────────────────────────
//
// Two signals a human should look at: a brand whose rating count jumped in a
// day, and a creator handing out an implausible number of ratings. Neither is
// proof of anything; both are worth a look.
async function listSuspiciousRatings(req, res, next) {
  try {
    const [spikes, prolific] = await Promise.all([
      db.query(
        `SELECT r.brand_id, bp.name AS brand_name,
                count(*)::int                                  AS ratings_24h,
                ROUND(AVG(r.score)::numeric, 2)                AS avg_24h,
                (SELECT count(*) FROM brand_ratings o WHERE o.brand_id = r.brand_id)::int AS ratings_total
           FROM brand_ratings r
           LEFT JOIN brand_profiles bp ON bp.user_id = r.brand_id
          WHERE r.created_at >= now() - interval '24 hours'
          GROUP BY r.brand_id, bp.name
         HAVING count(*) >= 5
          ORDER BY 3 DESC LIMIT 25`
      ),
      db.query(
        `SELECT r.influencer_id, ip.name AS influencer_name,
                count(*)::int                   AS ratings_given,
                ROUND(AVG(r.score)::numeric, 2) AS avg_given,
                min(r.created_at)               AS first_rating,
                max(r.created_at)               AS last_rating
           FROM brand_ratings r
           LEFT JOIN influencer_profiles ip ON ip.user_id = r.influencer_id
          GROUP BY r.influencer_id, ip.name
         HAVING count(*) >= 10
          ORDER BY 3 DESC LIMIT 25`
      ),
    ]);

    res.json({ spikes: spikes.rows, prolific_raters: prolific.rows });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/admin/ratings/:ratingId ─────────────────────────
async function deleteRating(req, res, next) {
  try {
    const { rows: [rating] } = await db.query(
      'DELETE FROM brand_ratings WHERE id = $1::uuid RETURNING id, brand_id, influencer_id, score',
      [req.params.ratingId]
    );
    if (!rating) return res.status(404).json({ error: 'Rating not found' });

    const { rows: [agg] } = await db.query(
      `SELECT count(*)::int AS count, ROUND(AVG(score)::numeric, 1) AS average
         FROM brand_ratings WHERE brand_id = $1`,
      [rating.brand_id]
    );

    // The brand's profile response embeds rating_avg/rating_count, and it is
    // cached — a stale profile is the only place a deleted rating survives.
    await invalidateCache(`cache:/api/profiles/${rating.brand_id}`);

    req.audit
      .set({ action: 'rating.delete', targetType: 'rating', targetId: rating.id, reason: req.body.reason })
      .add({ brand_id: rating.brand_id, influencer_id: rating.influencer_id, score: rating.score });

    res.json({
      removed: 1,
      brand_id: rating.brand_id,
      new_count: agg.count,
      new_average: agg.average === null ? null : Number(agg.average),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listRatings, listSuspiciousRatings, deleteRating };
