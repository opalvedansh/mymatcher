const db = require('../config/db');
const sharedCache = require('../utils/sharedCache');
const logger = require('../config/logger');
const { blockedBetween } = require('../utils/blocks');

/**
 * Ranked post feed.
 *
 * Two things make this different from the swipe deck in feedDeck.js. Posts keep
 * arriving, so a deck that lives too long hides new content; and the score
 * contains a recency term, so it drifts between requests, which makes plain
 * keyset pagination over the score unstable (rows shift between pages and the
 * reader sees duplicates or gaps).
 *
 * So: the first page (no cursor) always rebuilds the deck, which is what
 * pull-to-refresh hits. Later pages read the frozen deck, so a scroll session
 * paginates over one consistent ordering. Hydration re-runs the visibility
 * rules by id, so a post whose author was blocked or deleted mid-scroll drops
 * out even though the deck still lists it.
 *
 * Deck: { w (weights hash), items: [[postId, score], ...] }
 */

// ─── Scoring weights ──────────────────────────────────────────────────
const DEFAULT_WEIGHTS = {
  CATEGORY_AFFINITY: 40, // topics this viewer engages with
  ENGAGEMENT:        25, // how hard the post is landing, per unit of age
  RECENCY:           25, // freshness
  AUTHOR_AFFINITY:   10, // this specific creator
};

// Engagement is not one thing. A share costs the most social capital, so it
// says the most about what someone wants more of; a like says the least.
const ENGAGE_WEIGHT = { LIKE: 1, COMMENT: 2.5, SHARE: 4 };

const AFFINITY_WINDOW_DAYS  = 90;   // how far back tastes are read
const AFFINITY_HALFLIFE_H   = 24 * 21; // older engagements count for less
const CANDIDATE_WINDOW_DAYS = 45;   // how far back the feed will reach
const CANDIDATE_LIMIT       = 1000; // rows scored per deck build
const RECENCY_HALFLIFE_H    = 36;
const VELOCITY_SATURATION   = 250;  // weighted engagements treated as "peak"
const MAX_PER_AUTHOR        = 3;    // diversity cap across one deck

const DECK_SIZE         = Number(process.env.POST_DECK_SIZE) || 300;
const DECK_TTL_SECONDS  = Number(process.env.POST_DECK_TTL_SECONDS) || 10 * 60;
const WEIGHTS_KEY       = 'postfeed:weights';
const WEIGHTS_TTL_SECONDS = 60;

const deckKey = (userId) => `postfeed:deck:${userId}`;

// Stored weights are admin-editable JSON, so anything non-numeric falls back to
// the default rather than breaking the feed for every user.
function sanitizeWeights(raw) {
  const weights = {};
  for (const [key, fallback] of Object.entries(DEFAULT_WEIGHTS)) {
    const value = Number(raw?.[key]);
    weights[key] = Number.isFinite(value) ? value : fallback;
  }
  return weights;
}

async function loadWeights() {
  const cached = await sharedCache.get(WEIGHTS_KEY);
  if (cached) return cached;
  let weights;
  try {
    const { rows } = await db.query(
      "SELECT value FROM admin_settings WHERE key = 'post_feed_weights'"
    );
    weights = sanitizeWeights(rows[0]?.value);
  } catch {
    return DEFAULT_WEIGHTS; // table may not exist yet
  }
  await sharedCache.set(WEIGHTS_KEY, weights, WEIGHTS_TTL_SECONDS);
  return weights;
}

const invalidateWeights = () => sharedCache.del(WEIGHTS_KEY);
const invalidateDeck = (userId) => sharedCache.del(deckKey(userId));

// ─── Deck build ───────────────────────────────────────────────────────
// $1 viewer, $2..$5 weights, $6 category affinity half-life (seconds),
// $7 recency half-life (hours), $8 velocity saturation, $9 per-author cap,
// $10 deck size.
const DECK_SQL = `
  WITH engaged AS (
    SELECT
      p.user_id AS author_id,
      COALESCE(ip.categories, bp.categories) AS cats,
      e.w * exp(-EXTRACT(EPOCH FROM (now() - e.at)) / $6::numeric) AS w
    FROM (
      SELECT post_id, created_at AS at, ${ENGAGE_WEIGHT.LIKE}::numeric AS w
        FROM post_likes    WHERE user_id = $1
      UNION ALL
      SELECT post_id, created_at, ${ENGAGE_WEIGHT.COMMENT}::numeric
        FROM post_comments WHERE user_id = $1
      UNION ALL
      SELECT post_id, created_at, ${ENGAGE_WEIGHT.SHARE}::numeric
        FROM post_shares   WHERE user_id = $1
    ) e
    JOIN posts p ON p.id = e.post_id
    LEFT JOIN influencer_profiles ip ON ip.user_id = p.user_id
    LEFT JOIN brand_profiles     bp ON bp.user_id = p.user_id
    WHERE e.at > now() - INTERVAL '${AFFINITY_WINDOW_DAYS} days'
  ),
  cat_affinity AS (
    SELECT cat, SUM(w) AS w
    FROM engaged, unnest(COALESCE(cats, '{}')) AS cat
    GROUP BY cat
  ),
  author_affinity AS (
    SELECT author_id, SUM(w) AS w FROM engaged GROUP BY author_id
  ),
  totals AS (
    SELECT
      GREATEST(COALESCE((SELECT SUM(w) FROM cat_affinity), 0), 0.000001) AS cat_total,
      GREATEST(COALESCE((SELECT MAX(w) FROM author_affinity), 0), 0.000001) AS author_max,
      EXISTS (SELECT 1 FROM engaged) AS has_history
  ),
  candidates AS (
    SELECT
      p.id, p.user_id, p.likes_count, p.comments_count, p.shares_count,
      COALESCE(ip.categories, bp.categories) AS cats,
      EXTRACT(EPOCH FROM (now() - p.created_at)) / 3600.0 AS age_hours
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN influencer_profiles ip ON ip.user_id = p.user_id
    LEFT JOIN brand_profiles     bp ON bp.user_id = p.user_id
    WHERE u.banned = false
      AND u.deleted_at IS NULL
      AND p.created_at > now() - INTERVAL '${CANDIDATE_WINDOW_DAYS} days'
      AND NOT ${blockedBetween('$1', 'p.user_id')}
    ORDER BY p.created_at DESC
    LIMIT ${CANDIDATE_LIMIT}
  ),
  scored AS (
    SELECT c.id, c.user_id,
      ROUND(CAST(
        -- 1. Category affinity. With no engagement history every post scores
        --    the same here, so a new user falls back to recency + engagement
        --    instead of getting an empty feed.
        $2::numeric * (
          CASE WHEN (SELECT has_history FROM totals) THEN
            LEAST(
              COALESCE((
                SELECT SUM(ca.w) FROM cat_affinity ca WHERE ca.cat = ANY(c.cats)
              ), 0) / (SELECT cat_total FROM totals),
              1.0
            )
          ELSE 0.5 END
        )
        -- 2. Engagement velocity: weighted engagements, log-damped so a viral
        --    post cannot dominate outright, divided down by age.
        + $3::numeric * LEAST(
            ln(1 + c.likes_count + ${ENGAGE_WEIGHT.COMMENT} * c.comments_count
                 + ${ENGAGE_WEIGHT.SHARE} * c.shares_count)
            / ln(1 + $8::numeric)
            / GREATEST(power(c.age_hours + 2, 0.3), 1.0),
            1.0
          )
        -- 3. Recency
        + $4::numeric * exp(-c.age_hours / $7::numeric)
        -- 4. Author affinity
        + $5::numeric * (
          CASE WHEN (SELECT has_history FROM totals) THEN
            LEAST(
              COALESCE((
                SELECT aa.w FROM author_affinity aa WHERE aa.author_id = c.user_id
              ), 0) / (SELECT author_max FROM totals),
              1.0
            )
          ELSE 0 END
        )
      AS numeric), 6) AS score
    FROM candidates c
  ),
  ranked AS (
    SELECT id, score,
      row_number() OVER (PARTITION BY user_id ORDER BY score DESC, id DESC) AS author_rank
    FROM scored
  )
  SELECT id, score
  FROM ranked
  WHERE author_rank <= $9::int
  ORDER BY score DESC, id DESC
  LIMIT $10::int`;

async function buildDeck(userId, weights) {
  const { rows } = await db.query(DECK_SQL, [
    userId,
    weights.CATEGORY_AFFINITY,
    weights.ENGAGEMENT,
    weights.RECENCY,
    weights.AUTHOR_AFFINITY,
    AFFINITY_HALFLIFE_H * 3600,
    RECENCY_HALFLIFE_H,
    VELOCITY_SATURATION,
    MAX_PER_AUTHOR,
    DECK_SIZE,
  ]);
  return rows.map((r) => [r.id, Number(r.score)]);
}

// ─── Hydration ────────────────────────────────────────────────────────
// Reloads current post and author data for a page of deck ids, re-applying the
// visibility rules. Ordering comes from the deck, not the database: WITH
// ORDINALITY carries the deck position through the join.
const HYDRATE_SQL = `
  SELECT
    p.id, p.user_id, p.image_url, p.caption,
    p.likes_count, p.comments_count, p.shares_count, p.created_at,
    COALESCE(ip.name, bp.name) AS author_name,
    COALESCE(ip.avatar_url, bp.logo_url) AS author_avatar,
    COALESCE(ip.categories, bp.categories) AS author_categories,
    COALESCE(ip.verified, bp.verified, false) AS author_verified,
    EXISTS (
      SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = $1
    ) AS liked_by_me,
    d.ord
  FROM unnest($2::uuid[]) WITH ORDINALITY AS d(post_id, ord)
  JOIN posts p ON p.id = d.post_id
  JOIN users u ON u.id = p.user_id
  LEFT JOIN influencer_profiles ip ON ip.user_id = p.user_id
  LEFT JOIN brand_profiles     bp ON bp.user_id = p.user_id
  WHERE u.banned = false
    AND u.deleted_at IS NULL
    AND NOT ${blockedBetween('$1', 'p.user_id')}
  ORDER BY d.ord`;

async function hydrate(userId, ids) {
  if (!ids.length) return [];
  const { rows } = await db.query(HYDRATE_SQL, [userId, ids]);
  return rows.map(({ ord, ...post }) => post);
}

/**
 * One page of the ranked feed.
 *
 * @param {string} userId
 * @param {string|null} cursor Opaque cursor from the previous page. Absent or
 *   unusable means "start over", which also rebuilds the deck.
 * @param {number} limit
 * @returns {Promise<{ posts: object[], next_cursor: string|null }>}
 */
async function getPage(userId, cursor, limit) {
  const weights = await loadWeights();
  const weightsHash = JSON.stringify(weights);

  let offset = 0;
  let deck = null;

  if (cursor) {
    const parsed = parseCursor(cursor);
    if (parsed) {
      const cached = await sharedCache.get(deckKey(userId));
      // A deck rebuilt under different weights would renumber every position,
      // so an offset into the old one is meaningless.
      if (cached && cached.w === weightsHash && Array.isArray(cached.items)) {
        deck = cached.items;
        offset = parsed.offset;
      }
    }
  }

  if (!deck) {
    deck = await buildDeck(userId, weights);
    offset = 0;
    try {
      await sharedCache.set(
        deckKey(userId),
        { w: weightsHash, items: deck },
        DECK_TTL_SECONDS
      );
    } catch (err) {
      // Without a cached deck every page rebuilds and ranking still works;
      // only cross-page stability is lost. Not worth failing the request.
      logger?.warn?.({ err, userId }, '[postRanking] deck cache write failed');
    }
  }

  // Hydration drops posts that are no longer visible, so a page can come back
  // short. Walk forward until the page is full or the deck runs out, rather
  // than handing back a half-empty page that stops the reader's scroll.
  const posts = [];
  let position = offset;
  while (posts.length < limit && position < deck.length) {
    const slice = deck.slice(position, position + (limit - posts.length) + 5);
    if (!slice.length) break;
    position += slice.length;
    posts.push(...(await hydrate(userId, slice.map(([id]) => id))));
  }

  const trimmed = posts.slice(0, limit);
  // Anything fetched past the page boundary is dropped, so the next cursor has
  // to point at the deck position actually consumed, not at `position`.
  const consumed = trimmed.length === posts.length
    ? position
    : offset + countConsumed(deck, offset, trimmed);

  return {
    posts: trimmed,
    next_cursor: consumed < deck.length ? makeCursor(consumed) : null,
  };
}

// How many deck entries were used to produce `served`, counting the ones that
// hydration filtered out along the way.
function countConsumed(deck, offset, served) {
  if (!served.length) return 0;
  const lastId = served[served.length - 1].id;
  for (let i = offset; i < deck.length; i++) {
    if (deck[i][0] === lastId) return i - offset + 1;
  }
  return served.length;
}

const makeCursor = (offset) =>
  Buffer.from(JSON.stringify({ o: offset })).toString('base64url');

function parseCursor(cursor) {
  try {
    const { o } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Number.isInteger(o) && o >= 0 ? { offset: o } : null;
  } catch {
    return null;
  }
}

module.exports = {
  getPage,
  invalidateDeck,
  invalidateWeights,
  DEFAULT_WEIGHTS,
  _internal: { buildDeck, loadWeights, makeCursor, parseCursor },
};
