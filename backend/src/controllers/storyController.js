const db = require('../config/db');
const { isOwnUploadUrl } = require('../utils/storage');

async function uploadStory(req, res, next) {
  try {
    const userId = req.user.id;
    const { media_url } = req.body;

    if (!isOwnUploadUrl(media_url, userId)) {
      return res.status(400).json({ error: 'media_url must be an image you uploaded' });
    }

    const { rows } = await db.query(
      `INSERT INTO stories (user_id, media_url) 
       VALUES ($1, $2) 
       RETURNING *`,
      [userId, media_url]
    );

    res.json(rows[0]);
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
      SELECT s.id, s.user_id, s.media_url, s.created_at, s.expires_at,
             u.role,
             COALESCE(bp.name, ip.name) as name,
             COALESCE(bp.logo_url, ip.avatar_url) as avatar
      FROM stories s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN brand_profiles bp ON bp.user_id = u.id
      LEFT JOIN influencer_profiles ip ON ip.user_id = u.id
      WHERE s.user_id = ANY($1) AND s.expires_at > NOW()
      ORDER BY s.created_at ASC
      LIMIT 1000
    `, [allowedUserIds]);

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

module.exports = {
  uploadStory,
  getFeedStories,
  recordView,
  getViewers
};
