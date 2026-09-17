const db = require('../config/db');
const notificationService = require('../services/notificationService');
const analytics = require('../services/analytics');
const { blockedBetween } = require('../utils/blocks');
const feedDeck = require('../services/feedDeck');
const realtime = require('../realtime');

// Undo window in seconds (30s)
const UNDO_WINDOW_SECONDS = 30;

/**
 * POST /api/swipes
 *
 * Body: { swiped_id: string, direction: "like" | "reject" | "super_like" }
 *
 * Records a swipe. If direction is "like" or "super_like", checks for a
 * reciprocal like and creates a mutual match if found.
 *
 * Returns:
 *   { swipe, matched: boolean, match?: { id, matched_at, relevance_score } }
 */
async function recordSwipe(req, res, next) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { id: swiperId, role: swiperRole } = req.user;
    const { swiped_id, direction } = req.body;

    // 1. Verify the swiped user exists and is the opposite role
    const { rows: [swipedUser] } = await client.query(
      `SELECT id, role, ${blockedBetween('$2', 'id')} AS blocked FROM users WHERE id = $1`,
      [swiped_id, swiperId]
    );
    // A blocked pair looks the same as a missing user, so blocks aren't revealed.
    if (!swipedUser || swipedUser.blocked) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Swiped user not found' });
    }
    const oppositeRole = swiperRole === 'brand' ? 'influencer' : 'brand';
    if (swipedUser.role !== oppositeRole) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'You can only swipe on users of the opposite type',
      });
    }

    // Serialise swipes between this pair. Without it, two people liking each
    // other at the same moment each miss the other's uncommitted swipe under
    // READ COMMITTED, and the match is never created.
    const pairKey = [swiperId, swiped_id].sort().join(':');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [pairKey]);

    // 2. Insert the swipe — ON CONFLICT allows undo then re-swipe
    const { rows: [swipe] } = await client.query(
      `INSERT INTO swipes (swiper_id, swiped_id, direction, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (swiper_id, swiped_id)
         DO UPDATE SET direction = EXCLUDED.direction, updated_at = now()
       RETURNING *`,
      [swiperId, swiped_id, direction]
    );

    // 3. If the swipe is a "like" or "super_like", check for reciprocal
    let matched = false;
    let match   = null;
    let relevanceScore = null;
    let names = [];

    if (direction === 'like' || direction === 'super_like') {
      const { rows: reciprocal } = await client.query(
        `SELECT id FROM swipes
         WHERE swiper_id = $1 AND swiped_id = $2
           AND direction IN ('like', 'super_like')`,
        [swiped_id, swiperId]
      );

      if (reciprocal.length) {
        const brandId      = swiperRole === 'brand' ? swiperId : swiped_id;
        const influencerId = swiperRole === 'influencer' ? swiperId : swiped_id;

        // Calculate a basic relevance score to store on the match
        relevanceScore = direction === 'super_like' ? 100 : 75;

        const { rows: [newMatch] } = await client.query(
          `INSERT INTO matches (brand_id, influencer_id, relevance_score)
           VALUES ($1, $2, $3)
           ON CONFLICT (brand_id, influencer_id)
             DO UPDATE SET status = 'active', relevance_score = GREATEST(matches.relevance_score, EXCLUDED.relevance_score)
           RETURNING *`,
          [brandId, influencerId, relevanceScore]
        );

        matched = true;
        match   = newMatch || null;

        ({ rows: names } = await client.query(
          `SELECT user_id, name FROM (
             SELECT user_id, name FROM brand_profiles WHERE user_id = $1 OR user_id = $2
             UNION
             SELECT user_id, name FROM influencer_profiles WHERE user_id = $1 OR user_id = $2
           ) profiles`,
          [swiperId, swiped_id]
        ));
      }
    }

    await client.query('COMMIT');

    // Side effects run only once the swipe and match are durable, so nobody is
    // told about a match that was rolled back.
    analytics.trackEvent(swiperId, 'Profile_Swiped', { direction, targetRole: swipedUser.role });
    if (matched) {
      analytics.trackEvent(swiperId, 'Match_Created', { matchId: match?.id, relevanceScore });
      analytics.trackEvent(swiped_id, 'Match_Created', { matchId: match?.id, relevanceScore });

      const swiperName = names.find(n => n.user_id === swiperId)?.name || 'Someone';
      const swipedName = names.find(n => n.user_id === swiped_id)?.name || 'Someone';
      notificationService
        .sendMatchNotifications({ swiperId, swiperName, swipedId: swiped_id, swipedName })
        .catch((err) => console.error('[Push] Match notification failed:', err));
    }

    res.status(201).json({ swipe, matched, match });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/swipes/last
 *
 * Undoes the most recent swipe if it was within the UNDO_WINDOW_SECONDS window.
 * Also removes any match that was created by this swipe.
 *
 * Returns: { undone: boolean, swipe?: row }
 */
async function undoLastSwipe(req, res, next) {
  const client = await db.getClient();
  let removedMatchIds = [];
  try {
    await client.query('BEGIN');

    const { id: userId } = req.user;

    // Find the most recent swipe within the undo window
    const { rows: [lastSwipe] } = await client.query(
      `SELECT * FROM swipes
       WHERE swiper_id = $1
         AND updated_at >= now() - ($2 || ' seconds')::interval
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId, UNDO_WINDOW_SECONDS]
    );

    if (!lastSwipe) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Nothing to undo — undo window is ${UNDO_WINDOW_SECONDS} seconds`,
      });
    }

    // Remove the swipe
    await client.query(
      'DELETE FROM swipes WHERE id = $1',
      [lastSwipe.id]
    );

    // If it was a like/super_like, remove any resulting match
    if (lastSwipe.direction === 'like' || lastSwipe.direction === 'super_like') {
      const { rows } = await client.query(
        `DELETE FROM matches
         WHERE (brand_id = $1 AND influencer_id = $2)
            OR (brand_id = $2 AND influencer_id = $1)
         RETURNING id`,
        [userId, lastSwipe.swiped_id]
      );
      removedMatchIds = (rows || []).map((m) => m.id);
    }

    await client.query('COMMIT');
    // The undone profile was dropped from the deck when it was swiped.
    await Promise.all([feedDeck.invalidate(userId), realtime.closeMatches(removedMatchIds)]);

    res.json({ undone: true, swipe: lastSwipe });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

/**
 * GET /api/swipes
 * Returns all swipes made BY the current user.
 */
async function getMySwipes(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = parseInt(req.query.offset, 10) || 0;

    const { rows } = await db.query(
      `SELECT s.id, s.swiped_id, s.direction, s.created_at, s.updated_at, u.role AS swiped_role
       FROM swipes s
       JOIN users u ON u.id = s.swiped_id
       WHERE s.swiper_id = $1
       ORDER BY s.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );
    res.json({ data: rows, next_offset: offset + limit });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/swipes/received
 * Returns people who liked the current user but haven't matched yet.
 */
async function getLikesReceived(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const { id: userId } = req.user;

    const { rows } = await db.query(
      `SELECT 
         s.id AS swipe_id, s.direction, s.created_at,
         u.id AS user_id, u.role,
         ip.name AS influencer_name, ip.avatar_url AS influencer_avatar, ip.verified AS influencer_verified, ip.location AS influencer_location,
         bp.name AS brand_name, bp.logo_url AS brand_logo, bp.verified AS brand_verified, bp.location AS brand_location
       FROM swipes s
       JOIN users u ON u.id = s.swiper_id
       LEFT JOIN influencer_profiles ip ON ip.user_id = u.id AND u.role = 'influencer'
       LEFT JOIN brand_profiles bp ON bp.user_id = u.id AND u.role = 'brand'
       WHERE s.swiped_id = $1
         AND s.direction IN ('like', 'super_like')
         AND NOT ${blockedBetween('$1', 's.swiper_id')}
         AND NOT EXISTS (
           SELECT 1 FROM matches m 
           WHERE (m.brand_id = $1 AND m.influencer_id = s.swiper_id)
              OR (m.influencer_id = $1 AND m.brand_id = s.swiper_id)
         )
       ORDER BY s.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    res.json({ data: rows, next_offset: offset + limit });
  } catch (err) {
    next(err);
  }
}

module.exports = { recordSwipe, undoLastSwipe, getMySwipes, getLikesReceived };
