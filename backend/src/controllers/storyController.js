const db = require('../config/db');
const { isOwnUploadUrl } = require('../utils/storage');
const { sanitizeLayout, LayoutError } = require('../utils/storyLayout');
const { blockedBetween } = require('../utils/blocks');
const { sendStoryMentionNotifications } = require('../services/notificationService');
const sharedCache = require('../utils/sharedCache');
const logger = require('../config/logger');

const VIDEO_EXT_RE = /\.(mp4|mov|m4v)$/i;
const IMAGE_EXT_RE = /\.(jpg|png|webp)$/i;
const MAX_VIDEO_MS = 60_000;

/** The ids among `ids` that `userId` has an active, unblocked match with, with their names. */
async function matchedUsers(userId, ids) {
  if (!ids.length) return new Map();
  const { rows } = await db.query(
    `SELECT u.id, COALESCE(bp.name, ip.name, 'User') AS name
       FROM users u
       LEFT JOIN brand_profiles bp ON bp.user_id = u.id
       LEFT JOIN influencer_profiles ip ON ip.user_id = u.id
      WHERE u.id = ANY($2::text[])
        AND EXISTS (
          SELECT 1 FROM matches m
           WHERE m.status = 'active'
             AND ((m.brand_id = $1 AND m.influencer_id = u.id) OR (m.influencer_id = $1 AND m.brand_id = u.id))
        )
        AND NOT ${blockedBetween('$1', 'u.id')}`,
    [userId, ids]
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function uploadStory(req, res, next) {
  try {
    const userId = req.user.id;
    const { media_url, layout } = req.body;
    const hasMedia = media_url != null;
    const isVideo = req.body.media_type === 'video';
    const audience = req.body.audience === 'close_friends' ? 'close_friends' : 'all';

    if (hasMedia && !isOwnUploadUrl(media_url, userId)) {
      return res.status(400).json({ error: 'media_url must be an image you uploaded' });
    }
    // Apps from before the editor send only a photo; a text-only story is
    // nothing but its layout.
    if (!hasMedia && layout == null) {
      return res.status(400).json({ error: 'A story needs a photo or a layout' });
    }
    let durationMs = null;
    if (isVideo) {
      const path = hasMedia ? new URL(media_url).pathname : '';
      if (!VIDEO_EXT_RE.test(path)) return res.status(400).json({ error: 'A video story needs an uploaded video' });
      durationMs = Number(req.body.duration_ms);
      if (!Number.isFinite(durationMs) || durationMs < 300) {
        return res.status(400).json({ error: 'duration_ms is required for a video story' });
      }
      durationMs = Math.min(Math.round(durationMs), MAX_VIDEO_MS);
    } else if (hasMedia && !IMAGE_EXT_RE.test(new URL(media_url).pathname)) {
      return res.status(400).json({ error: 'media_url must be an image you uploaded' });
    }

    let cleanLayout = null;
    if (layout != null) {
      try {
        cleanLayout = sanitizeLayout(layout, { hasMedia, isVideo });
      } catch (err) {
        if (err instanceof LayoutError) return res.status(400).json({ error: err.message });
        throw err;
      }
    }

    // Mentions are only for matches (nobody else can see a story), and show
    // the person's real name whatever the app sent.
    const mentionIds = [...new Set((cleanLayout?.layers || []).filter((l) => l.type === 'mention').map((l) => l.userId))];
    const names = await matchedUsers(userId, mentionIds);
    if (names.size !== mentionIds.length) {
      return res.status(400).json({ error: 'You can only mention people you have matched with' });
    }
    for (const l of cleanLayout?.layers || []) {
      if (l.type === 'mention') l.text = `@${names.get(l.userId)}`;
    }

    const { rows } = await db.query(
      `INSERT INTO stories (user_id, media_url, layout, audience, media_type, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, hasMedia ? media_url : null, cleanLayout ? JSON.stringify(cleanLayout) : null,
        audience, isVideo ? 'video' : 'image', durationMs]
    );
    const story = rows[0];

    // Only people who can see the story hear about being mentioned in it.
    let notify = mentionIds;
    if (audience === 'close_friends' && notify.length) {
      const { rows: cf } = await db.query(
        'SELECT friend_id FROM close_friends WHERE user_id = $1 AND friend_id = ANY($2::text[])',
        [userId, notify]
      );
      notify = cf.map((r) => r.friend_id);
    }
    sendStoryMentionNotifications({ storyId: story.id, authorId: userId, mentionedIds: notify });

    res.json(story);
  } catch (err) {
    next(err);
  }
}

async function getFeedStories(req, res, next) {
  try {
    const userId = req.user.id;

    // Get matched users
    const matchesResult = await db.query(
      `SELECT brand_id, influencer_id 
       FROM matches 
       WHERE (brand_id = $1 OR influencer_id = $1) AND status = 'active'
       ORDER BY matched_at DESC
       LIMIT 1000`,
      [userId]
    );

    const matchedUserIds = matchesResult.rows.map(row => 
      row.brand_id === userId ? row.influencer_id : row.brand_id
    );

    // Include the user themselves in the allowed list
    const allowedUserIds = [userId, ...matchedUserIds];

    const { rows } = await db.query(`
      SELECT s.id, s.user_id, s.media_url, s.layout, s.audience, s.media_type, s.duration_ms,
             s.created_at, s.expires_at,
             u.role,
             COALESCE(bp.name, ip.name) as name,
             COALESCE(bp.logo_url, ip.avatar_url) as avatar
      FROM stories s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN brand_profiles bp ON bp.user_id = u.id
      LEFT JOIN influencer_profiles ip ON ip.user_id = u.id
      WHERE s.user_id = ANY($1) AND s.expires_at > NOW()
        -- Close Friends stories reach only the author's list.
        AND (s.audience = 'all' OR s.user_id = $2 OR EXISTS (
          SELECT 1 FROM close_friends cf WHERE cf.user_id = s.user_id AND cf.friend_id = $2
        ))
      ORDER BY s.created_at ASC
      LIMIT 1000
    `, [allowedUserIds, userId]);

    // Group stories by user
    const groupedStories = {};
    
    rows.forEach(story => {
      if (!groupedStories[story.user_id]) {
        groupedStories[story.user_id] = {
          id: story.user_id, // We use user_id as the group id
          name: story.name || 'User',
          avatar: story.avatar,
          isMe: story.user_id === userId,
          items: []
        };
      }
      groupedStories[story.user_id].items.push({
        id: story.id,
        media_url: story.media_url,
        layout: story.layout,
        media_type: story.media_type,
        duration_ms: story.duration_ms,
        close_friends: story.audience === 'close_friends',
        created_at: story.created_at,
        expires_at: story.expires_at
      });
    });

    // Make sure 'isMe' is always the first item in the array, even if empty
    let myGroup = groupedStories[userId];
    if (!myGroup) {
      // Fetch my own profile details so I can render the Add Story button with my avatar
      const myProfile = await db.query(`
        SELECT COALESCE(bp.name, ip.name) as name,
               COALESCE(bp.logo_url, ip.avatar_url) as avatar
        FROM users u
        LEFT JOIN brand_profiles bp ON bp.user_id = u.id
        LEFT JOIN influencer_profiles ip ON ip.user_id = u.id
        WHERE u.id = $1
      `, [userId]);

      const profileInfo = myProfile.rows[0] || {};
      
      myGroup = {
        id: userId,
        name: 'Your story',
        avatar: profileInfo.avatar,
        isMe: true,
        items: []
      };
    } else {
      myGroup.name = 'Your story';
    }

    const otherStories = Object.values(groupedStories)
      .filter(group => group.id !== userId)
      .sort((a, b) => b.items[b.items.length - 1].created_at - a.items[a.items.length - 1].created_at);

    const finalStories = [myGroup, ...otherStories];

    res.json(finalStories);
  } catch (err) {
    next(err);
  }
}

async function recordView(req, res, next) {
  try {
    const userId = req.user.id;
    const { storyId } = req.params;

    await db.query(
      `INSERT INTO story_views (story_id, viewer_id) 
       VALUES ($1, $2) 
       ON CONFLICT (story_id, viewer_id) DO NOTHING`,
      [storyId, userId]
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function getViewers(req, res, next) {
  try {
    const userId = req.user.id;
    const { storyId } = req.params;

    // Verify ownership
    const storyResult = await db.query(
      `SELECT user_id FROM stories WHERE id = $1`,
      [storyId]
    );
    
    if (storyResult.rowCount === 0) {
      return res.status(404).json({ error: 'Story not found' });
    }
    
    if (storyResult.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to view viewers of this story' });
    }

    const { rows } = await db.query(
      `SELECT v.viewed_at,
              u.id as user_id, 
              u.role, 
              COALESCE(bp.name, ip.name) as name, 
              COALESCE(bp.logo_url, ip.avatar_url) as avatar
       FROM story_views v
       JOIN users u ON v.viewer_id = u.id
       LEFT JOIN brand_profiles bp ON bp.user_id = u.id
       LEFT JOIN influencer_profiles ip ON ip.user_id = u.id
       WHERE v.story_id = $1
       ORDER BY v.viewed_at DESC
       LIMIT 500`,
      [storyId]
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// ─── Close Friends ────────────────────────────────────────────────

/**
 * GET /api/stories/audience
 * Everyone who can see your stories (your active matches), with whether each
 * is on your Close Friends list. Feeds the Close Friends list and @mentions.
 */
async function getAudience(req, res, next) {
  try {
    const userId = req.user.id;
    const { rows } = await db.query(
      `SELECT u.id, u.role,
              COALESCE(bp.name, ip.name, 'User') AS name,
              COALESCE(bp.logo_url, ip.avatar_url) AS avatar,
              EXISTS (SELECT 1 FROM close_friends cf WHERE cf.user_id = $1 AND cf.friend_id = u.id) AS close_friend
         FROM matches m
         JOIN users u ON u.id = CASE WHEN m.brand_id = $1 THEN m.influencer_id ELSE m.brand_id END
         LEFT JOIN brand_profiles bp ON bp.user_id = u.id
         LEFT JOIN influencer_profiles ip ON ip.user_id = u.id
        WHERE (m.brand_id = $1 OR m.influencer_id = $1) AND m.status = 'active'
          AND NOT ${blockedBetween('$1', 'u.id')}
        ORDER BY name
        LIMIT 1000`,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/stories/close-friends  { ids: string[] }
 * Replaces the Close Friends list. Ids that aren't current matches are dropped.
 */
async function setCloseFriends(req, res, next) {
  try {
    const userId = req.user.id;
    const ids = [...new Set(req.body.ids)].filter((id) => id !== userId);
    const allowed = [...(await matchedUsers(userId, ids)).keys()];
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM close_friends WHERE user_id = $1', [userId]);
      if (allowed.length) {
        await client.query(
          'INSERT INTO close_friends (user_id, friend_id) SELECT $1, unnest($2::text[])',
          [userId, allowed]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    res.json({ ids: allowed });
  } catch (err) {
    next(err);
  }
}

// ─── Music ────────────────────────────────────────────────────────

const ITUNES_TIMEOUT_MS = 6000;

function toTrack(r) {
  if (!r?.previewUrl || !r.trackId) return null;
  return {
    id: r.trackId,
    title: r.trackName,
    artist: r.artistName,
    // iTunes serves any square size by renaming the file.
    artwork: r.artworkUrl100 ? r.artworkUrl100.replace(/100x100bb/, '300x300bb') : null,
    preview: r.previewUrl,
    url: r.trackViewUrl || null,
    duration_ms: r.trackTimeMillis || null,
  };
}

async function itunes(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ITUNES_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`iTunes HTTP ${res.status}`);
  return res.json();
}

/**
 * GET /api/stories/music?q=&country=
 * Songs with 30-second Apple Music previews. With a query, an iTunes search;
 * without, what is most played in the country right now. Cached, so a story
 * tray opening doesn't hit Apple for every user.
 */
async function searchMusic(req, res, next) {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const country = /^[a-z]{2}$/i.test(req.query.country || '') ? req.query.country.toLowerCase() : 'in';
    const key = `story-music:${country}:${q.toLowerCase()}`;
    const cached = await sharedCache.get(key);
    if (cached) return res.json(cached);

    let tracks;
    if (q) {
      const data = await itunes(
        `https://itunes.apple.com/search?media=music&entity=song&limit=30&country=${country}&term=${encodeURIComponent(q)}`
      );
      tracks = (data.results || []).map(toTrack).filter(Boolean);
    } else {
      // The chart has no previews, so its ids are looked up for them.
      const chart = await itunes(`https://rss.marketingtools.apple.com/api/v2/${country}/music/most-played/30/songs.json`);
      const ids = (chart.feed?.results || []).map((r) => r.id).filter(Boolean);
      const data = ids.length ? await itunes(`https://itunes.apple.com/lookup?country=${country}&id=${ids.join(',')}`) : { results: [] };
      const byId = new Map((data.results || []).map((r) => [String(r.trackId), toTrack(r)]));
      tracks = ids.map((id) => byId.get(String(id))).filter(Boolean);
    }

    await sharedCache.set(key, tracks, q ? 60 * 60 : 6 * 60 * 60);
    res.json(tracks);
  } catch (err) {
    logger.warn({ err: err.message }, '[stories] music search failed');
    res.status(502).json({ error: 'Music is unavailable right now' });
  }
}

module.exports = {
  getAudience,
  setCloseFriends,
  searchMusic,
  uploadStory,
  getFeedStories,
  recordView,
  getViewers
};
