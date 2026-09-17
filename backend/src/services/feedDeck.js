const sharedCache = require('../utils/sharedCache');
const logger = require('../config/logger');
const ranking = require('./feedRanking');

/**
 * Precomputed swipe decks.
 *
 * Scoring every candidate is the expensive part of the feed, so it runs once
 * per deck (DECK_SIZE ranked ids) instead of once per page. Pages are then
 * served from the deck and "hydrated": the same ranking query, restricted to
 * those ids, which re-applies swipes, blocks and deleted accounts and returns
 * current profile data. Decks live in Redis so any instance can serve the next
 * page; without Redis they are cached per instance.
 *
 * Deck: { role, w (weights), from (cursor it starts after, or null),
 *         complete (no candidates beyond it), items: [[id, score], ...] }
 */
const DECK_SIZE = Number(process.env.FEED_DECK_SIZE) || 200;
const DECK_TTL_SECONDS = Number(process.env.FEED_DECK_TTL_SECONDS) || 10 * 60;
const HYDRATE_SLACK = 5;
const MAX_REBUILDS = 3;
const MAX_BATCH = 200;

const deckKey = (userId) => `feed:deck:${userId}`;

// Deck order: score descending, then id descending.
const isAfter = ([id, s], cursor) => !cursor || s < cursor.s || (s === cursor.s && id < cursor.id);

// Does a deck starting after `from` contain every position after `cursor`?
function covers(from, cursor) {
  if (!from) return true;
  if (!cursor) return false;
  return cursor.s < from.s || (cursor.s === from.s && cursor.id <= from.id);
}

async function build(ctx, from) {
  const rows = await ranking.scoreCandidates(ctx, { cursor: from, limit: DECK_SIZE });
  const deck = {
    role: ctx.role,
    w: ctx.weightsHash,
    from,
    complete: rows.length < DECK_SIZE,
    items: rows.map((r) => [r.id, Number(r.relevance_score)]),
  };
  await sharedCache.set(deckKey(ctx.userId), deck, DECK_TTL_SECONDS);
  return deck;
}

/**
 * Returns up to `limit` feed rows ranked after `cursor`, plus the cursor for
 * the next page (null when there is none).
 */
async function getPage(ctx, { cursor = null, limit }) {
  let deck = await sharedCache.get(deckKey(ctx.userId));
  let rebuilds = 0;
  if (!deck || deck.role !== ctx.role || deck.w !== ctx.weightsHash || !covers(deck.from, cursor)) {
    deck = await build(ctx, cursor);
    rebuilds++;
  }

  const out = [];
  const gone = new Set();
  let position = cursor;
  let hydrations = 0;

  while (out.length < limit) {
    const remaining = deck.items.filter((item) => isAfter(item, position));
    if (!remaining.length) {
      if (deck.complete || rebuilds >= MAX_REBUILDS) break;
      // Deck used up: rank the next DECK_SIZE after the last position.
      deck = await build(ctx, position);
      rebuilds++;
      continue;
    }

    // Batches double when entries keep turning out swiped (e.g. reopening the
    // app from the top of a half-used deck), bounding the number of queries.
    const size = Math.min((limit - out.length + HYDRATE_SLACK) * 2 ** hydrations, MAX_BATCH);
    hydrations++;
    const batch = remaining.slice(0, size);
    const rows = await ranking.scoreCandidates(ctx, { ids: batch.map(([id]) => id), limit: batch.length });
    const byId = new Map(rows.map((r) => [r.id, r]));

    for (const item of batch) {
      const row = byId.get(item[0]);
      if (!row) {
        gone.add(item[0]);
      } else if (out.length < limit) {
        out.push(row);
        position = { s: item[1], id: item[0] };
      }
    }
    // Everything in the batch has been looked at, so move past it even when
    // the tail was swiped or blocked.
    const last = batch[batch.length - 1];
    if (out.length < limit) position = { s: last[1], id: last[0] };
  }

  if (gone.size) {
    // Drop swiped / blocked / deleted ids so later pages skip them for free.
    deck.items = deck.items.filter(([id]) => !gone.has(id));
    sharedCache.set(deckKey(ctx.userId), deck, DECK_TTL_SECONDS).catch(() => {});
  }

  return {
    rows: out,
    nextCursor: out.length === limit ? position : null,
  };
}

/** Builds a fresh deck ahead of the user's next feed request. */
async function warm(userId, role) {
  const ctx = await ranking.loadContext(userId, role);
  if (!ctx.profile) return;
  await build(ctx, null);
}

function invalidate(userId) {
  return sharedCache.del(deckKey(userId));
}

// Rebuild after a profile change, off the request path when a worker exists.
async function refreshAfterProfileChange(userId, role) {
  await Promise.all([invalidate(userId), ranking.invalidateViewer(userId)]);
  const { enqueueFeedWarm } = require('../config/queue');
  try {
    await enqueueFeedWarm(userId, role);
  } catch (err) {
    logger.warn({ err: err.message, userId }, '[feedDeck] could not queue deck warm-up');
  }
}

module.exports = { getPage, warm, invalidate, refreshAfterProfileChange, DECK_SIZE };
