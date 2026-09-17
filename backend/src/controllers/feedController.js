const ranking = require('../services/feedRanking');
const feedDeck = require('../services/feedDeck');

/**
 * GET /api/feed
 *
 * Returns scored, cursor-paginated candidates for the current user to swipe on,
 * served from the user's precomputed deck (see services/feedDeck.js).
 *
 * Query params:
 *   limit        (default 10, max 50)
 *   cursor_score (optional, for pagination)
 *   cursor_id    (optional, for pagination)
 */
async function getFeed(req, res, next) {
  try {
    const { id: userId, role } = req.user;
    const limit = Math.min(parseInt(req.query.limit || '10', 10), 50);
    const cursorScore = req.query.cursor_score ? parseFloat(req.query.cursor_score) : null;
    const cursorId = req.query.cursor_id || null;
    const cursor = Number.isFinite(cursorScore) && cursorId ? { s: cursorScore, id: String(cursorId) } : null;

    const ctx = await ranking.loadContext(userId, role);
    const { rows, nextCursor } = await feedDeck.getPage(ctx, { cursor, limit });

    res.json({
      data:        rows,
      count:       rows.length,
      next_cursor_score: nextCursor ? nextCursor.s : null,
      next_cursor_id: nextCursor ? nextCursor.id : null,
      scoring: {
        weights: ctx.weights,
        description: 'Relevance score out of 100. Uses cursor-based pagination and array intersections.',
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getFeed, sanitizeWeights: ranking.sanitizeWeights };
