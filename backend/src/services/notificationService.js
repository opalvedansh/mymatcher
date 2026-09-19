const db = require('../config/db');
const { pushQueue } = require('../config/queue');
const { Expo } = require('expo-server-sdk');

// Shared Expo client for inline fallback sending
const expo = new Expo();

// Maximum IDs to batch in a single DB query / BullMQ addBulk call
const CHUNK_SIZE = 500;

/**
 * Splits an array into chunks of at most `size`.
 * @template T
 * @param {T[]} arr
 * @param {number} size
 * @returns {T[][]}
 */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Sends push notifications to ONE OR MANY users in as few DB round trips as possible.
 *
 * - Fetches all push tokens in a single batched SELECT … WHERE id = ANY($1)
 * - If BullMQ is available: enqueues all messages with a single addBulk() call per chunk
 * - If BullMQ is unavailable (no Redis): sends notifications inline via the Expo SDK
 *
 * @param {Array<{ userId: string, title: string, body: string, data?: object }>} notifications
 */
async function sendBulkNotifications(notifications) {
  if (!notifications.length) return;

  try {
    // ── 1. Gather unique user IDs ─────────────────────────────────────
    const userIds = [...new Set(notifications.map(n => n.userId))];

    // ── 2. Batch-fetch all push tokens in ONE round trip ─────────────
    const { rows } = await db.query(
      `SELECT id, expo_push_token
       FROM users
       WHERE id = ANY($1) AND expo_push_token IS NOT NULL`,
      [userIds]
    );

    // Build userId → token map
    const tokenMap = new Map(rows.map(r => [r.id, r.expo_push_token]));

    // ── 3. Build message list, skipping users with no token ───────────
    const messages = notifications
      .filter(n => tokenMap.has(n.userId))
      .map(n => ({
        token: tokenMap.get(n.userId),
        title: n.title,
        body:  n.body,
        data:  n.data || {},
      }));

    if (!messages.length) {
      console.log('[Push] No tokens found for recipients — skipping.');
      return;
    }

    let queued = false;
    if (pushQueue) {
      // ── 4a. BullMQ path: enqueue in chunks ──────────────────────────
      const jobs = messages.map(m => ({
        name: 'send_push',
        data: m,
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      }));

      try {
        for (const jobChunk of chunk(jobs, CHUNK_SIZE)) {
          await pushQueue.addBulk(jobChunk);
        }
        queued = true;
      } catch (err) {
        // Redis unavailable: send directly rather than lose the notifications.
        console.error('[Push] Queue unavailable, sending inline:', err.message);
      }
    }
    if (!queued) {
      // ── 4b. Inline fallback: send directly via Expo SDK ─────────────
      console.log(`[Push] BullMQ unavailable — sending ${messages.length} notification(s) inline.`);

      const expoMessages = messages
        .filter(m => Expo.isExpoPushToken(m.token))
        .map(m => ({
          to: m.token,
          sound: 'default',
          title: m.title,
          body: m.body,
          data: m.data,
        }));

      if (expoMessages.length) {
        // Expo SDK batches internally via chunks
        const chunks = expo.chunkPushNotifications(expoMessages);
        for (const chunk of chunks) {
          try {
            await expo.sendPushNotificationsAsync(chunk);
          } catch (err) {
            console.error('[Push] Inline Expo send failed:', err);
          }
        }
      }
    }
  } catch (err) {
    console.error('[Push] Failed to queue bulk notifications:', err);
  }
}

/**
 * Saves notifications to the in-app inbox (what the bell shows).
 * A `new_message` item is kept to one unread row per conversation: a newer
 * message bumps the existing row instead of adding another.
 * Failures are logged, never thrown, so the push still goes out.
 *
 * @param {Array<{ userId: string,
 *   type: 'new_match'|'new_like'|'new_message'|'post_like'|'post_comment'|'comment_reply',
 *   actorId?: string|null, matchId?: string|null, postId?: string|null,
 *   commentId?: string|null, title: string, body?: string }>} items
 */
async function recordNotifications(items) {
  if (!items.length) return;
  try {
    const others = items.filter(i => i.type !== 'new_message');
    if (others.length) {
      await db.query(
        `INSERT INTO notifications (user_id, type, actor_id, match_id, post_id, comment_id, title, body)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::uuid[], $5::uuid[], $6::uuid[], $7::text[], $8::text[])`,
        [
          others.map(i => i.userId),
          others.map(i => i.type),
          others.map(i => i.actorId ?? null),
          others.map(i => i.matchId ?? null),
          others.map(i => i.postId ?? null),
          others.map(i => i.commentId ?? null),
          others.map(i => i.title),
          others.map(i => i.body ?? ''),
        ]
      );
    }
    for (const i of items.filter(n => n.type === 'new_message')) {
      await db.query(
        `INSERT INTO notifications (user_id, type, actor_id, match_id, title, body)
         VALUES ($1, 'new_message', $2, $3, $4, $5)
         ON CONFLICT (user_id, match_id) WHERE type = 'new_message' AND read_at IS NULL
         DO UPDATE SET created_at = now(), title = EXCLUDED.title, body = EXCLUDED.body`,
        [i.userId, i.actorId ?? null, i.matchId ?? null, i.title, i.body ?? '']
      );
    }
  } catch (err) {
    console.error('[Notifications] Failed to record inbox items:', err);
  }
}

/**
 * Sends a push notification to a single user.
 * Internally delegates to sendBulkNotifications (1-element batch).
 *
 * @param {string} userId
 * @param {string} title
 * @param {string} body
 * @param {object} [data={}]
 */
async function sendNotification(userId, title, body, data = {}) {
  await sendBulkNotifications([{ userId, title, body, data }]);
}

/**
 * Notifies BOTH users when a match is formed — single DB round trip for both tokens.
 *
 * @param {{ swiperId: string, swiperName: string, swipedId: string, swipedName: string, matchId?: string }} params
 */
async function sendMatchNotifications({ swiperId, swiperName, swipedId, swipedName, matchId = null }) {
  const items = [
    {
      userId: swipedId,
      actorId: swiperId,
      type: 'new_match',
      matchId,
      title: 'New match',
      body: `You matched with ${swiperName}. Say hi!`,
    },
    {
      userId: swiperId,
      actorId: swipedId,
      type: 'new_match',
      matchId,
      title: 'New match',
      body: `You matched with ${swipedName}. Say hi!`,
    },
  ];
  try {
    // A like that turned into a match is now shown as the match instead.
    await db.query(
      `DELETE FROM notifications
       WHERE type = 'new_like' AND read_at IS NULL
         AND ((user_id = $1 AND actor_id = $2) OR (user_id = $2 AND actor_id = $1))`,
      [swiperId, swipedId]
    );
  } catch (err) {
    console.error('[Notifications] Failed to clear like items:', err);
  }
  await recordNotifications(items);
  await sendBulkNotifications(items.map(i => ({
    userId: i.userId,
    title: i.title,
    body: i.body,
    data: { type: 'new_match', matchId },
  })));
}

/**
 * Legacy single-user match notification (kept for backwards compatibility).
 */
async function sendMatchNotification(userId, matchName) {
  await sendNotification(userId, 'New match', `You matched with ${matchName}. Say hi!`, { type: 'new_match' });
}

/**
 * Tells a user someone liked them, without saying who: seeing who liked
 * you is a premium feature, so the liker stays anonymous here too.
 *
 * @param {string} likedUserId
 * @param {string} likerId  stored for blocking checks only, never returned for likes
 */
async function sendLikeNotification(likedUserId, likerId) {
  const item = {
    userId: likedUserId,
    actorId: likerId,
    type: 'new_like',
    title: 'Someone likes you',
    body: 'Check your Likes tab.',
  };
  await recordNotifications([item]);
  await sendBulkNotifications([{ userId: item.userId, title: item.title, body: item.body, data: { type: 'new_like' } }]);
}

/**
 * Triggers when a chat message is received.
 * Looks up the sender's name in a UNION query then sends via sendBulkNotifications.
 */
async function sendChatNotification(receiverId, senderId, matchId = null) {
  try {
    // Fetch sender name — single query
    const { rows } = await db.query(
      `SELECT name FROM (
         SELECT name FROM brand_profiles     WHERE user_id = $1
         UNION
         SELECT name FROM influencer_profiles WHERE user_id = $1
       ) AS profiles LIMIT 1`,
      [senderId]
    );
    const senderName = rows[0]?.name || 'Someone';

    // The body stays generic: message text would otherwise pass in plaintext
    // through Expo/Apple/Google and show on the lock screen.
    const title = `New message from ${senderName}`;
    await recordNotifications([{
      userId: receiverId,
      actorId: senderId,
      type: 'new_message',
      matchId,
      title,
      body: 'Tap to read',
    }]);
    await sendBulkNotifications([{
      userId: receiverId,
      title,
      body:   'Tap to read',
      data:   { type: 'new_message', senderId, matchId },
    }]);
  } catch (err) {
    console.error('[Push] Error sending chat notification:', err);
  }
}

/** Display name for either profile type, or 'Someone' when neither exists. */
async function displayName(userId) {
  const { rows } = await db.query(
    `SELECT name FROM (
       SELECT name FROM brand_profiles      WHERE user_id = $1
       UNION
       SELECT name FROM influencer_profiles WHERE user_id = $1
     ) AS profiles LIMIT 1`,
    [userId]
  );
  return rows[0]?.name || 'Someone';
}

/**
 * Notifies the post author that someone liked their post.
 * Self-likes are skipped. Never throws: a failed notification must not fail
 * the like itself.
 */
async function sendPostLikeNotification({ postId, postAuthorId, likerId }) {
  if (!postAuthorId || postAuthorId === likerId) return;
  try {
    const name = await displayName(likerId);
    const title = `${name} liked your post`;
    await recordNotifications([
      { userId: postAuthorId, actorId: likerId, type: 'post_like', postId, title, body: '' },
    ]);
    await sendBulkNotifications([
      { userId: postAuthorId, title, body: '', data: { type: 'post_like', postId } },
    ]);
  } catch (err) {
    console.error('[Push] Error sending post like notification:', err);
  }
}

/**
 * Notifies on a new comment: the post author for a top-level comment, the
 * parent commenter for a reply. A reply does not also ping the post author —
 * that turns every thread on a popular post into a notification storm.
 *
 * The comment body is included: unlike chat, a public comment is not private,
 * and the preview is what makes the notification worth opening.
 */
async function sendCommentNotification({ postId, commentId, commentBody, actorId, recipientId, isReply }) {
  if (!recipientId || recipientId === actorId) return;
  try {
    const name = await displayName(actorId);
    const title = isReply ? `${name} replied to you` : `${name} commented on your post`;
    const body = commentBody.length > 120 ? `${commentBody.slice(0, 119)}…` : commentBody;
    const type = isReply ? 'comment_reply' : 'post_comment';

    await recordNotifications([
      { userId: recipientId, actorId, type, postId, commentId, title, body },
    ]);
    await sendBulkNotifications([
      { userId: recipientId, title, body, data: { type, postId, commentId } },
    ]);
  } catch (err) {
    console.error('[Push] Error sending comment notification:', err);
  }
}

module.exports = {
  recordNotifications,
  sendNotification,
  sendLikeNotification,
  sendBulkNotifications,
  sendMatchNotification,
  sendMatchNotifications,
  sendChatNotification,
  sendPostLikeNotification,
  sendCommentNotification,
};
