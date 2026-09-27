const db = require('../config/db');
const logger = require('../config/logger');
const { encrypt, decrypt } = require('../utils/encryption');
const storage = require('../utils/chatStorage');

/**
 * Chat messages: everything the socket handlers and the chat REST routes do
 * to the messages table. Callers check that the user belongs to the match
 * (realtime.getMatchMembers) before calling in; these functions check
 * everything about the message itself.
 *
 * A message row is turned into its API shape by hydrate(): content and
 * attachment decrypted, media given short-lived signed URLs, the quoted
 * message and the reactions attached.
 */

// Loaded on first use: bad-words pulls in an ES-module-only dependency, and
// everything that reads messages (the inbox, the admin panel) loads this file.
let contentFilter;
function getContentFilter() {
  if (contentFilter === undefined) {
    try {
      const { Filter } = require('bad-words');
      contentFilter = new Filter();
    } catch (err) {
      logger.error({ err: err.message }, '[chat] profanity filter unavailable');
      contentFilter = null;
    }
  }
  return contentFilter;
}

const KINDS = ['text', 'image', 'video', 'audio', 'document'];
const MAX_MESSAGE_LENGTH = 2000;
const MAX_CLIENT_ID_LENGTH = 64;
const MAX_FILE_NAME_LENGTH = 255;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const DELETE_FOR_EVERYONE_WINDOW_MS = 48 * 60 * 60 * 1000;
const MEDIA_URL_TTL_SECONDS = 24 * 60 * 60;
const MAX_FORWARD_TARGETS = 5;
const MAX_BATCH_IDS = 100;
const MAX_MEDIA_DURATION_MS = 6 * 60 * 60 * 1000;
const MAX_WAVEFORM_BARS = 64;
const REPLY_PREVIEW_LENGTH = 200;
// Far enough away to mean "until unmuted"; 'infinity' does not survive JSON.
const MUTED_FOREVER = '9999-12-31T00:00:00.000Z';
const MUTE_DURATIONS_MS = { '8h': 8 * 3600 * 1000, '1w': 7 * 24 * 3600 * 1000 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

const COLUMNS = `id, match_id, sender_id, kind, content, attachment, reply_to_id, forwarded,
  created_at, delivered_at, read_at, edited_at, deleted_at, client_msg_id`;
const M_COLUMNS = COLUMNS.split(',').map((c) => `m.${c.trim()}`).join(', ');

class ChatError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

function cleanText(text) {
  const trimmed = text.trim();
  if (!trimmed) return '';
  try {
    return getContentFilter()?.clean(trimmed) ?? trimmed;
  } catch (err) {
    logger.warn({ err: err.message }, '[chat] content moderation failed');
    return trimmed;
  }
}

function readText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ChatError('bad_content');
  if (value.length > MAX_MESSAGE_LENGTH) throw new ChatError('too_long');
  return value;
}

const positiveInt = (v, max) => (Number.isFinite(v) && v > 0 && v <= max ? Math.round(v) : undefined);

/** Validates what the client says about an upload. The file itself is checked in storage. */
function readAttachmentInput(kind, input, senderId) {
  if (!input || typeof input !== 'object') throw new ChatError('attachment_required');
  if (!storage.isOwnChatPath(input.path, senderId)) throw new ChatError('bad_attachment');
  const mime = typeof input.mime === 'string' ? input.mime.toLowerCase() : '';
  if (!storage.extensionFor(kind, mime, input.path)) throw new ChatError('unsupported_type');

  const out = { path: input.path, mime };
  if (kind === 'document') {
    const name = typeof input.name === 'string'
      ? input.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_FILE_NAME_LENGTH)
      : '';
    out.name = name || input.path.split('/').pop();
  }
  if (kind === 'image' || kind === 'video') {
    const width = positiveInt(input.width, 20000);
    const height = positiveInt(input.height, 20000);
    if (width && height) Object.assign(out, { width, height });
  }
  if (kind === 'audio' || kind === 'video') {
    const duration = positiveInt(input.duration_ms, MAX_MEDIA_DURATION_MS);
    if (duration) out.duration_ms = duration;
  }
  if (kind === 'audio' && Array.isArray(input.waveform)) {
    const bars = input.waveform.slice(0, MAX_WAVEFORM_BARS).map(Number);
    if (bars.every((b) => Number.isFinite(b) && b >= 0 && b <= 1)) {
      out.waveform = bars.map((b) => Math.round(b * 100) / 100);
    }
  }
  return out;
}

async function openAttachment(row) {
  if (!row.attachment || row.deleted_at) return null;
  try {
    return JSON.parse(await decrypt(row.attachment));
  } catch {
    return null;
  }
}

/** The public shape of an attachment: never the storage path. */
function publicAttachment(att, urls, expiresAt) {
  if (!att) return null;
  const out = {
    key: att.path.split('/')[1],
    url: urls.get(att.path) ?? null,
    expires_at: expiresAt,
    mime: att.mime,
    size: att.size ?? null,
  };
  for (const field of ['name', 'width', 'height', 'duration_ms', 'waveform']) {
    if (att[field] !== undefined) out[field] = att[field];
  }
  return out;
}

/**
 * Turns message rows into their API shape. One query for quoted messages, one
 * for reactions and one storage call for every signed URL, however many rows.
 */
async function hydrate(rows) {
  if (!rows.length) return [];

  const opened = await Promise.all(rows.map(async (row) => ({
    row,
    content: row.deleted_at ? '' : ((await decrypt(row.content)) ?? ''),
    attachment: await openAttachment(row),
  })));

  const replyIds = [...new Set(rows.map((r) => r.reply_to_id).filter(Boolean))];
  const replies = new Map();
  if (replyIds.length) {
    const { rows: quoted } = await db.query(
      `SELECT id, sender_id, kind, content, attachment, deleted_at FROM messages WHERE id = ANY($1::uuid[])`,
      [replyIds]
    );
    await Promise.all(quoted.map(async (q) => {
      const text = q.deleted_at ? '' : ((await decrypt(q.content)) ?? '');
      replies.set(q.id, { row: q, text: text.slice(0, REPLY_PREVIEW_LENGTH), attachment: await openAttachment(q) });
    }));
  }

  const paths = opened.map((o) => o.attachment?.path);
  for (const r of replies.values()) {
    if (r.row.kind === 'image') paths.push(r.attachment?.path);
  }
  const urls = await storage.signPaths(paths, MEDIA_URL_TTL_SECONDS);
  const expiresAt = new Date(Date.now() + MEDIA_URL_TTL_SECONDS * 1000).toISOString();

  const reactions = new Map();
  const { rows: reactionRows } = await db.query(
    `SELECT message_id, user_id, emoji FROM message_reactions
      WHERE message_id = ANY($1::uuid[]) ORDER BY created_at`,
    [rows.map((r) => r.id)]
  );
  for (const r of reactionRows) {
    if (!reactions.has(r.message_id)) reactions.set(r.message_id, []);
    reactions.get(r.message_id).push({ user_id: r.user_id, emoji: r.emoji });
  }

  return opened.map(({ row, content, attachment }) => {
    const quoted = row.reply_to_id ? replies.get(row.reply_to_id) : null;
    return {
      id: row.id,
      match_id: row.match_id,
      sender_id: row.sender_id,
      kind: row.kind || 'text',
      content,
      attachment: publicAttachment(attachment, urls, expiresAt),
      reply_to: quoted
        ? {
            id: quoted.row.id,
            sender_id: quoted.row.sender_id,
            kind: quoted.row.kind || 'text',
            text: quoted.text,
            deleted: !!quoted.row.deleted_at,
            name: quoted.attachment?.name ?? null,
            duration_ms: quoted.attachment?.duration_ms ?? null,
            thumb_url: quoted.row.kind === 'image' && quoted.attachment ? urls.get(quoted.attachment.path) ?? null : null,
            thumb_key: quoted.row.kind === 'image' && quoted.attachment ? quoted.attachment.path.split('/')[1] : null,
          }
        : null,
      reactions: row.deleted_at ? [] : (reactions.get(row.id) || []),
      forwarded: !!row.forwarded,
      created_at: row.created_at,
      delivered_at: row.delivered_at,
      read_at: row.read_at,
      edited_at: row.edited_at,
      deleted_at: row.deleted_at,
      client_msg_id: row.client_msg_id ?? null,
    };
  });
}

async function hydrateOne(row) {
  return (await hydrate([row]))[0];
}

async function getMessageRow(messageId) {
  if (!isUuid(messageId)) return null;
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM messages WHERE id = $1`, [messageId]);
  return rows[0] || null;
}

async function findByClientId(senderId, clientId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM messages WHERE sender_id = $1 AND client_msg_id = $2`,
    [senderId, clientId]
  );
  return rows[0] || null;
}

/**
 * Stores a new message. `input` is the client payload:
 * { kind?, content?, clientId?, replyToId?, attachment? }.
 * With a clientId, a retry returns the original instead of a second copy.
 */
async function createMessage({ matchId, senderId, input }) {
  const kind = input.kind === undefined ? 'text' : input.kind;
  if (!KINDS.includes(kind)) throw new ChatError('bad_kind');
  const text = readText(input.content);
  if (kind === 'text' && !text.trim()) throw new ChatError('empty');

  const { clientId } = input;
  if (clientId !== undefined && clientId !== null
      && (typeof clientId !== 'string' || !clientId || clientId.length > MAX_CLIENT_ID_LENGTH)) {
    throw new ChatError('bad_client_id');
  }
  if (clientId) {
    const existing = await findByClientId(senderId, clientId);
    if (existing) return { message: await hydrateOne(existing), duplicate: true };
  }

  let replyToId = null;
  if (input.replyToId !== undefined && input.replyToId !== null) {
    if (!isUuid(input.replyToId)) throw new ChatError('bad_reply');
    const { rows } = await db.query(
      'SELECT 1 FROM messages WHERE id = $1 AND match_id = $2',
      [input.replyToId, matchId]
    );
    if (!rows.length) throw new ChatError('bad_reply');
    replyToId = input.replyToId;
  }

  let attachment = null;
  if (kind !== 'text') {
    attachment = readAttachmentInput(kind, input.attachment, senderId);
    // Trust storage, not the client, for what was actually uploaded.
    const stat = await storage.statObject(attachment.path);
    if (!stat) throw new ChatError('upload_missing');
    if (stat.size > storage.MAX_BYTES[kind]) {
      storage.removeObjects([attachment.path]);
      throw new ChatError('too_large');
    }
    attachment.size = stat.size;
    const stored = stat.contentType?.split(';')[0].trim().toLowerCase();
    if (stored && storage.extensionFor(kind, stored, attachment.path)) attachment.mime = stored;
  }

  // Voice notes have no caption, as on WhatsApp.
  const body = kind === 'audio' ? '' : cleanText(text);
  const { rows } = await db.query(
    `INSERT INTO messages (match_id, sender_id, kind, content, attachment, reply_to_id, client_msg_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (sender_id, client_msg_id) WHERE client_msg_id IS NOT NULL DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      matchId, senderId, kind,
      await encrypt(body),
      attachment ? await encrypt(JSON.stringify(attachment)) : null,
      replyToId,
      clientId || null,
    ]
  );

  if (!rows.length) {
    // Lost a race with a concurrent retry of the same message.
    const original = await findByClientId(senderId, clientId);
    if (!original) throw new ChatError('server_error');
    return { message: await hydrateOne(original), duplicate: true };
  }
  return { message: await hydrateOne(rows[0]), duplicate: false };
}

/** Text and captions can be changed for 15 minutes; voice notes cannot. */
async function editMessage(row, userId, content) {
  if (row.sender_id !== userId) throw new ChatError('forbidden');
  if (row.deleted_at) throw new ChatError('deleted');
  if (row.kind === 'audio') throw new ChatError('not_editable');
  if (Date.now() - new Date(row.created_at).getTime() > EDIT_WINDOW_MS) throw new ChatError('too_late');
  const body = cleanText(readText(content));
  if (row.kind === 'text' && !body) throw new ChatError('empty');

  const { rows } = await db.query(
    `UPDATE messages SET content = $2, edited_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${COLUMNS}`,
    [row.id, await encrypt(body)]
  );
  if (!rows.length) throw new ChatError('deleted');
  return hydrateOne(rows[0]);
}

/** Replaces the message with "This message was deleted" for both people. */
async function deleteForEveryone(row, userId) {
  if (row.sender_id !== userId) throw new ChatError('forbidden');
  if (row.deleted_at) return hydrateOne(row);
  if (Date.now() - new Date(row.created_at).getTime() > DELETE_FOR_EVERYONE_WINDOW_MS) {
    throw new ChatError('too_late');
  }
  const attachment = await openAttachment(row);
  const { rows } = await db.query(
    `UPDATE messages
        SET deleted_at = now(), content = '', attachment = NULL, edited_at = NULL, forwarded = false
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [row.id]
  );
  await db.query('DELETE FROM message_reactions WHERE message_id = $1', [row.id]);
  // Forwarded copies have their own files, so this cannot break them.
  if (attachment?.path) await storage.removeObjects([attachment.path]);
  return hydrateOne(rows[0]);
}

/** "Delete for me": hides messages from this user only. Returns the ids hidden. */
async function hideForMe(matchId, userId, messageIds) {
  const ids = [...new Set((Array.isArray(messageIds) ? messageIds : [messageIds]).filter(isUuid))];
  if (!ids.length || ids.length > MAX_BATCH_IDS) throw new ChatError('bad_ids');
  const { rows } = await db.query(
    `INSERT INTO message_hidden (user_id, message_id)
     SELECT $1, id FROM messages WHERE id = ANY($2::uuid[]) AND match_id = $3
     ON CONFLICT DO NOTHING
     RETURNING message_id`,
    [userId, ids, matchId]
  );
  return rows.map((r) => r.message_id);
}

/** Sets (or with a falsy emoji, removes) this user's one reaction to a message. */
async function setReaction(row, userId, emoji) {
  if (row.deleted_at) throw new ChatError('deleted');
  if (emoji) {
    if (typeof emoji !== 'string' || emoji.length > 16 || !EMOJI_RE.test(emoji) || /[A-Za-z]/.test(emoji)) {
      throw new ChatError('bad_emoji');
    }
    await db.query(
      `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = now()`,
      [row.id, userId, emoji]
    );
  } else {
    await db.query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2', [row.id, userId]);
  }
  const { rows } = await db.query(
    'SELECT user_id, emoji FROM message_reactions WHERE message_id = $1 ORDER BY created_at',
    [row.id]
  );
  return rows;
}

/**
 * Copies a message into other conversations of the same user. The caller has
 * already checked `targetMatchIds` are this user's active matches.
 */
async function forwardMessage(row, userId, targetMatchIds) {
  if (row.deleted_at) throw new ChatError('deleted');
  const targets = [...new Set(targetMatchIds)];
  if (!targets.length || targets.length > MAX_FORWARD_TARGETS) throw new ChatError('bad_targets');

  const body = row.kind === 'audio' ? '' : ((await decrypt(row.content)) ?? '');
  const attachment = await openAttachment(row);
  if (row.kind !== 'text' && !attachment) throw new ChatError('bad_attachment');

  const created = [];
  for (const matchId of targets) {
    // Each copy gets its own file, so deleting one message never breaks another.
    const copy = attachment ? { ...attachment, path: await storage.copyObject(attachment.path, userId) } : null;
    const { rows } = await db.query(
      `INSERT INTO messages (match_id, sender_id, kind, content, attachment, forwarded)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING ${COLUMNS}`,
      [matchId, userId, row.kind, await encrypt(body), copy ? await encrypt(JSON.stringify(copy)) : null]
    );
    created.push(rows[0]);
  }
  return hydrate(created);
}

/**
 * Marks everything the other person sent in this match as read (and so
 * delivered). Returns how many changed and when.
 */
async function markRead(matchId, readerId) {
  const { rows: [res] } = await db.query(
    `WITH upd AS (
       UPDATE messages SET read_at = now(), delivered_at = COALESCE(delivered_at, now())
        WHERE match_id = $1 AND sender_id <> $2 AND read_at IS NULL
        RETURNING read_at
     )
     SELECT count(*)::int AS n, max(read_at) AS at FROM upd`,
    [matchId, readerId]
  );
  if (res.n > 0) {
    // The inbox item for this conversation is read once the chat is read.
    await db.query(
      `UPDATE notifications SET read_at = now()
        WHERE user_id = $1 AND match_id = $2 AND type = 'new_message' AND read_at IS NULL`,
      [readerId, matchId]
    );
  }
  return { count: res.n, at: res.at };
}

const GROUP_DELIVERED = `SELECT match_id, sender_id, max(delivered_at) AS at FROM upd GROUP BY match_id, sender_id`;

/** Receipts from the recipient's device. Returns { match_id, sender_id, at } per conversation. */
async function markDelivered(userId, messageIds) {
  const ids = [...new Set((Array.isArray(messageIds) ? messageIds : []).filter(isUuid))].slice(0, MAX_BATCH_IDS);
  if (!ids.length) return [];
  const { rows } = await db.query(
    `WITH upd AS (
       UPDATE messages m SET delivered_at = now()
         FROM matches mt
        WHERE m.id = ANY($2::uuid[]) AND m.delivered_at IS NULL AND m.sender_id <> $1
          AND mt.id = m.match_id AND (mt.brand_id = $1 OR mt.influencer_id = $1)
        RETURNING m.match_id, m.sender_id, m.delivered_at
     )
     ${GROUP_DELIVERED}`,
    [userId, ids]
  );
  return rows;
}

/** Everything waiting for a user who just came online counts as delivered. */
async function deliverPending(userId) {
  const { rows } = await db.query(
    `WITH upd AS (
       UPDATE messages m SET delivered_at = now()
         FROM matches mt
        WHERE mt.id = m.match_id AND mt.status = 'active'
          AND (mt.brand_id = $1 OR mt.influencer_id = $1)
          AND m.sender_id <> $1 AND m.delivered_at IS NULL
        RETURNING m.match_id, m.sender_id, m.delivered_at
     )
     ${GROUP_DELIVERED}`,
    [userId]
  );
  return rows;
}

/**
 * One page of a conversation as this viewer sees it: newest first, without
 * what they deleted for themselves or cleared.
 */
async function listMessages(matchId, viewerId, { limit, cursor }) {
  const params = [matchId, viewerId];
  let where = `m.match_id = $1
    AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.user_id = $2 AND h.message_id = m.id)
    AND m.created_at > COALESCE(
      (SELECT cleared_at FROM chat_member_state WHERE match_id = $1 AND user_id = $2), '-infinity'::timestamptz)`;
  if (cursor) where += ` AND m.created_at < $${params.push(cursor)}`;
  const { rows } = await db.query(
    `SELECT ${M_COLUMNS}
       FROM messages m
      WHERE ${where}
      ORDER BY m.created_at DESC
      LIMIT $${params.push(limit)}`,
    params
  );
  return { messages: await hydrate(rows), nextCursor: rows.length === limit ? rows[rows.length - 1].created_at : null };
}

async function getMemberState(matchId, userId) {
  const { rows } = await db.query(
    'SELECT cleared_at, muted_until FROM chat_member_state WHERE match_id = $1 AND user_id = $2',
    [matchId, userId]
  );
  const state = rows[0];
  const mutedUntil = state?.muted_until && new Date(state.muted_until) > new Date() ? state.muted_until : null;
  return { cleared_at: state?.cleared_at ?? null, muted_until: mutedUntil };
}

/** "Clear chat": hides everything sent so far, for this user only. */
async function clearChat(matchId, userId) {
  const { rows: [row] } = await db.query(
    `INSERT INTO chat_member_state (match_id, user_id, cleared_at, updated_at) VALUES ($1, $2, now(), now())
     ON CONFLICT (match_id, user_id) DO UPDATE SET cleared_at = now(), updated_at = now()
     RETURNING cleared_at`,
    [matchId, userId]
  );
  return row.cleared_at;
}

/** duration: '8h' | '1w' | 'always', or null to unmute. Returns muted_until. */
async function setMute(matchId, userId, duration) {
  let until = null;
  if (duration === 'always') until = MUTED_FOREVER;
  else if (duration && MUTE_DURATIONS_MS[duration]) until = new Date(Date.now() + MUTE_DURATIONS_MS[duration]).toISOString();
  else if (duration) throw new ChatError('bad_duration');

  const { rows: [row] } = await db.query(
    `INSERT INTO chat_member_state (match_id, user_id, muted_until, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (match_id, user_id) DO UPDATE SET muted_until = EXCLUDED.muted_until, updated_at = now()
     RETURNING muted_until`,
    [matchId, userId, until]
  );
  return row.muted_until;
}

async function isMuted(matchId, userId) {
  if (!matchId) return false;
  const { rows } = await db.query(
    'SELECT 1 FROM chat_member_state WHERE match_id = $1 AND user_id = $2 AND muted_until > now()',
    [matchId, userId]
  );
  return rows.length > 0;
}

/** A short, content-free description for lists and pushes ("Photo", "Voice message"). */
function describeKind(kind) {
  return { image: 'Photo', video: 'Video', audio: 'Voice message', document: 'Document' }[kind] || null;
}

module.exports = {
  ChatError,
  KINDS,
  MAX_MESSAGE_LENGTH,
  MAX_FORWARD_TARGETS,
  isUuid,
  hydrate,
  openAttachment,
  getMessageRow,
  createMessage,
  editMessage,
  deleteForEveryone,
  hideForMe,
  setReaction,
  forwardMessage,
  markRead,
  markDelivered,
  deliverPending,
  listMessages,
  getMemberState,
  clearChat,
  setMute,
  isMuted,
  describeKind,
};
