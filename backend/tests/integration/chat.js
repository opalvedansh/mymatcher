// Chat end to end against an in-process Postgres (PGlite, every migration)
// and a real Socket.io server, with Supabase Storage faked in memory:
//   - text, photo, video, voice note and document messages
//   - replies, edits, reactions, delete for everyone / for me, forwards
//   - delivery and read receipts, presence, typing
//   - the chat list (unread counts, previews, mute) and clear chat
//   - storage rules: own uploads only, allowed types, files removed on delete
//   - encryption: ciphertext at rest, plaintext fallback without a key
// Run with `npm run test:integration`.
const fs = require('fs');
const path = require('path');
const http = require('http');

const BACKEND = path.resolve(__dirname, '../..');

let failures = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(25);
  }
  return false;
}
function stub(rel, exports) {
  const filename = `${BACKEND}/${rel}`;
  require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] };
}

// ── Environment: must be set before any backend module loads ─────
process.env.NODE_ENV = 'development';
process.env.LOG_LEVEL = 'silent';
process.env.SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SOCKET_SWEEP_INTERVAL_MS = '3600000';
delete process.env.REDIS_URL;
delete process.env.ENCRYPTION_KEY;

let pg;
stub('src/config/db.js', {
  query: (text, params) => pg.query(text, params),
  getClient: async () => ({ query: (t, p) => pg.query(t, p), release() {} }),
  pool: { end() {} },
});
// Tokens in these tests are just the user id.
stub('src/utils/verifyToken.js', {
  verifySupabaseToken: async (token) => {
    if (!token || token.startsWith('bad')) throw new Error('invalid');
    return { sub: token, exp: Math.floor(Date.now() / 1000) + 3600 };
  },
});
const pushes = [];
stub('src/services/notificationService.js', {
  sendChatNotification: async (to, from, matchId, opts) => { pushes.push({ to, from, matchId, kind: opts?.kind }); },
});

// ── Supabase Storage, in memory ──────────────────────────────────
const objects = new Map(); // path -> { size, contentType }
const bucket = {
  async createSignedUploadUrl(p) {
    return { data: { signedUrl: `https://storage.test/upload/${p}?token=up`, token: 'up', path: p }, error: null };
  },
  async info(p) {
    const o = objects.get(p);
    return o ? { data: { size: o.size, contentType: o.contentType }, error: null }
      : { data: null, error: { message: 'Object not found', statusCode: '404' } };
  },
  async createSignedUrls(paths, ttl) {
    return { data: paths.map((p) => ({ path: p, signedUrl: `https://storage.test/sign/${p}?ttl=${ttl}`, error: null })), error: null };
  },
  async copy(from, to) {
    if (!objects.has(from)) return { data: null, error: { message: 'Object not found' } };
    objects.set(to, { ...objects.get(from) });
    return { data: { path: to }, error: null };
  },
  async remove(paths) {
    for (const p of paths) objects.delete(p);
    return { data: [], error: null };
  },
  async list(prefix) {
    const entries = new Map();
    for (const p of objects.keys()) {
      if (!p.startsWith(`${prefix}/`)) continue;
      const rest = p.slice(prefix.length + 1);
      const [head, ...tail] = rest.split('/');
      entries.set(head, tail.length ? { name: head, id: null } : { name: head, id: `id-${p}` });
    }
    return { data: [...entries.values()], error: null };
  },
};
const fakeAdmin = {
  storage: {
    createBucket: async () => ({ data: { name: 'chat-media' }, error: null }),
    updateBucket: async () => ({ data: {}, error: null }),
    from: () => bucket,
  },
};
stub('src/config/supabaseAdmin.js', { getSupabaseAdmin: () => fakeAdmin });

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
      setHeader() {},
    };
    handler({ query: {}, params: {}, body: {}, headers: {}, ...req }, res, (err) => resolve({ status: 'next', err }));
  });
}

async function main() {
  // ── Postgres ───────────────────────────────────────────────────
  const { PGlite } = await import('@electric-sql/pglite');
  const { postgis } = await import('@electric-sql/pglite-postgis');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { uuid_ossp } = await import('@electric-sql/pglite/contrib/uuid_ossp');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  pg = await PGlite.create({ extensions: { postgis, pg_trgm, uuid_ossp, pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
  const dir = `${BACKEND}/migrations`;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
  }
  // Migrations must be re-runnable: the deploy runner retries a failed one.
  await pg.exec(fs.readFileSync(path.join(dir, '030_chat_messaging.sql'), 'utf8'));
  check('migration 030 is idempotent', true);

  const B = 'brand-1';
  const B2 = 'brand-2';
  const I = 'infl-1';
  const X = 'infl-x';
  await pg.exec(`
    INSERT INTO users (id, email, role) VALUES
      ('${B}', 'b@x.com', 'brand'), ('${B2}', 'b2@x.com', 'brand'),
      ('${I}', 'i@x.com', 'influencer'), ('${X}', 'x@x.com', 'influencer');
    INSERT INTO brand_profiles (user_id, name, categories, budget_min, budget_max) VALUES
      ('${B}', 'Northlight', '{fashion}', 100, 1000), ('${B2}', 'Other Brand', '{tech}', 100, 1000);
    INSERT INTO influencer_profiles (user_id, name, categories, price_min, price_max) VALUES
      ('${I}', 'Alex', '{fashion}', 100, 500), ('${X}', 'Sam', '{tech}', 100, 500);
  `);
  const { rows: [match] } = await pg.query(`INSERT INTO matches (brand_id, influencer_id) VALUES ($1, $2) RETURNING id`, [B, I]);
  const { rows: [match2] } = await pg.query(`INSERT INTO matches (brand_id, influencer_id) VALUES ($1, $2) RETURNING id`, [B2, I]);
  const { rows: [otherMatch] } = await pg.query(`INSERT INTO matches (brand_id, influencer_id) VALUES ($1, $2) RETURNING id`, [B2, X]);

  // ── Chat server ────────────────────────────────────────────────
  const { initSocket, closeSocket } = require(`${BACKEND}/src/socket`);
  const server = http.createServer();
  initSocket(server);
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  const chatController = require(`${BACKEND}/src/controllers/chatController`);
  const matchController = require(`${BACKEND}/src/controllers/matchController`);
  const { isCiphertext } = require(`${BACKEND}/src/utils/encryption`);

  const { io } = require('socket.io-client');
  const clients = [];
  function connect(token) {
    const socket = io(url, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    clients.push(socket);
    const events = [];
    socket.onAny((event, payload) => events.push({ event, payload }));
    return new Promise((resolve) => {
      socket.on('connect', () => resolve({ socket, events }));
      socket.on('connect_error', (err) => resolve({ socket, events, error: err.message }));
    });
  }
  const got = (c, event) => c.events.filter((e) => e.event === event);
  const emit = (c, event, payload) => c.socket.timeout(5000).emitWithAck(event, payload);

  // Upload a file the way the app does: ask for a target, then "PUT" it.
  async function upload(userId, matchId, { kind, mime, size, name }, storedType = mime) {
    const r = await call(chatController.createUpload, {
      user: { id: userId }, params: { matchId }, body: { kind, mime, size, name },
    });
    if (r.status !== 201) return r;
    objects.set(r.body.path, { size, contentType: storedType });
    return r;
  }

  const brandC = await connect(B);
  const inflC = await connect(I);
  const outsider = await connect(X);
  check('participants connect', !brandC.error && !inflC.error, brandC.error || inflC.error);

  // ── Text, and where it is delivered ─────────────────────────────
  let ack = await emit(brandC, 'send_message', { matchId: match.id, content: 'hello', clientId: 'c-1' });
  check('text message acked with its stored copy', ack.ok && ack.message.content === 'hello' && ack.message.kind === 'text', JSON.stringify(ack));
  check('the receiver gets it without opening the chat (chat list, delivery receipts)',
    await waitFor(() => got(inflC, 'receive_message').some((e) => e.payload.id === ack.message.id)));
  check('push says nothing about the content', pushes.at(-1)?.to === I && pushes.at(-1)?.kind === 'text');
  const { rows: [stored] } = await pg.query('SELECT content FROM messages WHERE id = $1', [ack.message.id]);
  check('text is encrypted at rest', isCiphertext(stored.content));
  const textId = ack.message.id;

  const retry = await emit(brandC, 'send_message', { matchId: match.id, content: 'hello', clientId: 'c-1' });
  check('a retried send returns the original', retry.ok && retry.duplicate && retry.message.id === textId);

  ack = await emit(outsider, 'send_message', { matchId: match.id, content: 'spam' });
  check('non-participant cannot send', ack.ok === false && ack.error === 'not_found');
  ack = await emit(brandC, 'send_message', { matchId: match.id, content: '   ' });
  check('empty text rejected', ack.error === 'empty');

  // ── Uploads ────────────────────────────────────────────────────
  let r = await call(chatController.createUpload, {
    user: { id: B }, params: { matchId: match.id }, body: { kind: 'document', mime: 'text/html', size: 10, name: 'x.html' },
  });
  check('HTML cannot be uploaded', r.status === 422, JSON.stringify(r.body));
  r = await call(chatController.createUpload, {
    user: { id: B }, params: { matchId: match.id }, body: { kind: 'image', mime: 'image/png', size: 17 * 1024 * 1024 },
  });
  check('oversized photo refused before upload', r.status === 413);
  r = await call(chatController.createUpload, {
    user: { id: X }, params: { matchId: match.id }, body: { kind: 'image', mime: 'image/png', size: 10 },
  });
  check('outsider cannot get an upload URL for the chat', r.status === 403);

  // ── Photo with a caption ───────────────────────────────────────
  const photo = await upload(B, match.id, { kind: 'image', mime: 'image/jpeg', size: 2048 });
  check('upload target lives in the sender\'s own folder', photo.status === 201 && photo.body.path.startsWith(`${B}/`) && photo.body.path.endsWith('.jpg'));
  ack = await emit(brandC, 'send_message', {
    matchId: match.id, kind: 'image', content: 'our moodboard', clientId: 'c-img',
    attachment: { path: photo.body.path, mime: 'image/jpeg', size: 1, width: 1080, height: 1350 },
  });
  const photoMsg = ack.message;
  check('photo message acked with a signed URL', ack.ok && photoMsg.kind === 'image' && photoMsg.attachment.url.includes('/sign/') && photoMsg.content === 'our moodboard', JSON.stringify(ack));
  check('size comes from storage, not the client', photoMsg.attachment.size === 2048 && photoMsg.attachment.width === 1080);
  check('the raw storage path is never returned (only a signed URL)', !('path' in photoMsg.attachment));
  check('push says "Photo"', pushes.at(-1)?.kind === 'image');

  ack = await emit(brandC, 'send_message', {
    matchId: match.id, kind: 'image', attachment: { path: `${I}/00000000-0000-4000-8000-000000000000/photo.jpg`, mime: 'image/jpeg' },
  });
  check('cannot send someone else\'s file', ack.error === 'bad_attachment');
  const ghost = await call(chatController.createUpload, { user: { id: B }, params: { matchId: match.id }, body: { kind: 'image', mime: 'image/png', size: 10 } });
  ack = await emit(brandC, 'send_message', { matchId: match.id, kind: 'image', attachment: { path: ghost.body.path, mime: 'image/png' } });
  check('cannot send a file that was never uploaded', ack.error === 'upload_missing');

  // ── Voice note ─────────────────────────────────────────────────
  const voice = await upload(I, match.id, { kind: 'audio', mime: 'audio/mp4', size: 30000 });
  ack = await emit(inflC, 'send_message', {
    matchId: match.id, kind: 'audio', content: 'captions are dropped',
    attachment: { path: voice.body.path, mime: 'audio/mp4', duration_ms: 12500, waveform: [0.1, 0.5, 1, 0.3] },
  });
  const voiceMsg = ack.message;
  check('voice note keeps duration and waveform, drops a caption',
    ack.ok && voiceMsg.kind === 'audio' && voiceMsg.attachment.duration_ms === 12500
      && voiceMsg.attachment.waveform.length === 4 && voiceMsg.content === '', JSON.stringify(ack));

  // ── Document ───────────────────────────────────────────────────
  const doc = await upload(B, match.id, { kind: 'document', mime: 'application/pdf', size: 90000, name: 'Nike Campaign Brief (v2).pdf' });
  check('document keeps a readable, safe file name in storage', doc.body.path.endsWith('/Nike Campaign Brief (v2).pdf'), doc.body.path);
  ack = await emit(brandC, 'send_message', {
    matchId: match.id, kind: 'document', attachment: { path: doc.body.path, mime: 'application/pdf', name: 'Nike Campaign Brief (v2).pdf' },
  });
  const docMsg = ack.message;
  check('document message carries its name', ack.ok && docMsg.attachment.name === 'Nike Campaign Brief (v2).pdf');
  const { rows: [docRow] } = await pg.query('SELECT attachment FROM messages WHERE id = $1', [docMsg.id]);
  check('attachment details are encrypted at rest', isCiphertext(docRow.attachment) && !docRow.attachment.includes('Nike'));

  // ── Reply ──────────────────────────────────────────────────────
  ack = await emit(inflC, 'send_message', { matchId: match.id, content: 'love it', replyToId: photoMsg.id });
  check('reply carries a preview of the quoted photo',
    ack.ok && ack.message.reply_to?.id === photoMsg.id && ack.message.reply_to.kind === 'image'
      && ack.message.reply_to.text === 'our moodboard' && !!ack.message.reply_to.thumb_url, JSON.stringify(ack.message?.reply_to));
  const replyId = ack.message.id;
  ack = await emit(inflC, 'send_message', { matchId: match.id, content: 'x', replyToId: '00000000-0000-4000-8000-000000000000' });
  check('cannot quote a message from another chat', ack.error === 'bad_reply');

  // ── Edit ───────────────────────────────────────────────────────
  ack = await emit(brandC, 'edit_message', { messageId: textId, content: 'hello there' });
  check('sender can edit', ack.ok && ack.message.content === 'hello there' && !!ack.message.edited_at);
  check('the other side sees the edit', await waitFor(() => got(inflC, 'message_updated').some((e) => e.payload.id === textId && e.payload.content === 'hello there')));
  ack = await emit(inflC, 'edit_message', { messageId: textId, content: 'hijack' });
  check('only the sender can edit', ack.error === 'forbidden');
  ack = await emit(inflC, 'edit_message', { messageId: voiceMsg.id, content: 'x' });
  check('voice notes cannot be edited', ack.error === 'not_editable');
  await pg.query(`UPDATE messages SET created_at = now() - interval '16 minutes' WHERE id = $1`, [textId]);
  ack = await emit(brandC, 'edit_message', { messageId: textId, content: 'late' });
  check('edits close after 15 minutes', ack.error === 'too_late');

  // ── Reactions ──────────────────────────────────────────────────
  ack = await emit(inflC, 'react_message', { messageId: photoMsg.id, emoji: '❤️' });
  check('react', ack.ok && ack.reactions.length === 1 && ack.reactions[0].emoji === '❤️');
  check('reaction reaches the sender', await waitFor(() => got(brandC, 'message_reactions').some((e) => e.payload.messageId === photoMsg.id)));
  ack = await emit(inflC, 'react_message', { messageId: photoMsg.id, emoji: '🔥' });
  check('a second reaction replaces the first', ack.reactions.length === 1 && ack.reactions[0].emoji === '🔥');
  ack = await emit(inflC, 'react_message', { messageId: photoMsg.id, emoji: 'lol' });
  check('text is not a reaction', ack.error === 'bad_emoji');
  ack = await emit(outsider, 'react_message', { messageId: photoMsg.id, emoji: '👍' });
  check('outsiders cannot react', ack.error === 'not_found');

  // ── Receipts ───────────────────────────────────────────────────
  ack = await emit(brandC, 'send_message', { matchId: match.id, content: 'did you get this?' });
  const pingId = ack.message.id;
  await emit(inflC, 'mark_delivered', { messageIds: [pingId] });
  check('delivery receipt reaches the sender', await waitFor(() => got(brandC, 'messages_delivered').some((e) => e.payload.matchId === match.id)));
  ack = await emit(inflC, 'mark_read', { matchId: match.id });
  check('read receipt reaches the sender', ack.ok && ack.count > 0
    && await waitFor(() => got(brandC, 'messages_read').some((e) => e.payload.matchId === match.id && e.payload.readerId === I)));
  const { rows: [{ unread }] } = await pg.query(
    `SELECT count(*)::int AS unread FROM messages WHERE match_id = $1 AND sender_id = $2 AND read_at IS NULL`, [match.id, B]);
  check('mark_read marks everything read', unread === 0);

  // Offline recipient: delivered as soon as they connect.
  const b2 = await connect(B2);
  ack = await emit(b2, 'send_message', { matchId: match2.id, content: 'hi from brand 2' });
  const offlineMsgId = ack.message.id;
  inflC.socket.disconnect();
  await sleep(100);
  ack = await emit(b2, 'send_message', { matchId: match2.id, content: 'are you there?' });
  const { rows: [pending] } = await pg.query('SELECT delivered_at FROM messages WHERE id = $1', [ack.message.id]);
  check('a message to someone offline is not delivered yet', pending.delivered_at === null);
  const infl2 = await connect(I);
  check('reconnecting delivers what was waiting', await waitFor(() => got(b2, 'messages_delivered').some((e) => e.payload.matchId === match2.id)));

  // ── Presence ───────────────────────────────────────────────────
  ack = await emit(brandC, 'watch_presence', { userId: I });
  check('matched users can see online status', ack.ok && ack.online === true, JSON.stringify(ack));
  ack = await emit(brandC, 'watch_presence', { userId: X });
  check('presence is private to matches', ack.ok === false);
  infl2.socket.disconnect();
  check('going offline sets last seen', await waitFor(() => got(brandC, 'presence').some((e) => e.payload.userId === I && e.payload.online === false && e.payload.last_seen_at)));
  const inflC3 = await connect(I);
  check('coming back online is announced', await waitFor(() => got(brandC, 'presence').some((e) => e.payload.userId === I && e.payload.online === true)));

  // ── Typing ─────────────────────────────────────────────────────
  await emit(inflC3, 'join_match', match.id);
  await emit(brandC, 'join_match', match.id);
  inflC3.socket.emit('typing', { matchId: match.id, isTyping: true, kind: 'audio' });
  check('"recording audio" reaches the other side',
    await waitFor(() => got(brandC, 'typing').some((e) => e.payload.matchId === match.id && e.payload.kind === 'audio' && e.payload.userId === I)));

  // ── Forward ────────────────────────────────────────────────────
  ack = await emit(inflC3, 'forward_message', { messageId: docMsg.id, matchIds: [match2.id] });
  const fwd = ack.messages?.[0];
  check('forward copies a document into another chat', ack.ok && fwd.forwarded && fwd.match_id === match2.id && fwd.attachment.name === docMsg.attachment.name, JSON.stringify(ack));
  check('the forwarded copy has its own file', objects.size > 0 && [...objects.keys()].filter((p) => p.startsWith(`${I}/`) && p.endsWith('Brief (v2).pdf')).length === 1);
  check('the other chat receives it', await waitFor(() => got(b2, 'receive_message').some((e) => e.payload.id === fwd.id)));
  ack = await emit(inflC3, 'forward_message', { messageId: docMsg.id, matchIds: [otherMatch.id] });
  check('cannot forward into a chat you are not in', ack.error === 'not_found');

  // ── Delete ─────────────────────────────────────────────────────
  ack = await emit(inflC3, 'delete_message', { messageId: photoMsg.id, scope: 'everyone' });
  check('only the sender can delete for everyone', ack.error === 'forbidden');
  ack = await emit(brandC, 'delete_message', { messageId: photoMsg.id, scope: 'everyone' });
  check('delete for everyone', ack.ok && ack.message.deleted_at && ack.message.attachment === null && ack.message.content === '' && ack.message.reactions.length === 0);
  check('the deleted photo\'s file is removed', !objects.has(photo.body.path));
  check('the other side sees "This message was deleted"', await waitFor(() => got(inflC3, 'message_updated').some((e) => e.payload.id === photoMsg.id && e.payload.deleted_at)));
  ack = await emit(brandC, 'react_message', { messageId: photoMsg.id, emoji: '👍' });
  check('cannot react to a deleted message', ack.error === 'deleted');

  ack = await emit(inflC3, 'delete_message', { matchId: match.id, messageIds: [docMsg.id], scope: 'me' });
  check('delete for me', ack.ok && ack.ids.includes(docMsg.id));

  // ── History as each person sees it ─────────────────────────────
  r = await call(chatController.getMessages, { user: { id: I }, params: { matchId: match.id }, query: {} });
  const inflView = r.body.data;
  check('history loads for a participant', r.status === 200 && inflView.length > 0 && r.body.state?.muted_until === null, JSON.stringify(r.body).slice(0, 200));
  check('what I deleted for me is gone for me', !inflView.some((m) => m.id === docMsg.id));
  check('a quote of a deleted message says so', inflView.find((m) => m.id === replyId)?.reply_to?.deleted === true);
  r = await call(chatController.getMessages, { user: { id: B }, params: { matchId: match.id }, query: {} });
  check('...but still there for the other person', r.body.data.some((m) => m.id === docMsg.id));
  r = await call(chatController.getMessages, { user: { id: X }, params: { matchId: match.id }, query: {} });
  check('outsiders cannot read history', r.status === 403);

  // ── Chat list ──────────────────────────────────────────────────
  await emit(brandC, 'send_message', { matchId: match.id, content: 'one' });
  const clip = await upload(B, match.id, { kind: 'video', mime: 'video/mp4', size: 500000 });
  await emit(brandC, 'send_message', { matchId: match.id, kind: 'video', attachment: { path: clip.body.path, mime: 'video/mp4', duration_ms: 8000 } });
  r = await call(matchController.getMatches, { user: { id: I, role: 'influencer' }, query: {} });
  const row = r.body.data.find((m) => m.match_id === match.id);
  check('chat list counts unread messages', row?.unread_count === 2, JSON.stringify(row && { unread: row.unread_count }));
  check('chat list labels an attachment without exposing it', row?.last_message_label === 'Video' && row.last_message_attachment === undefined);
  r = await call(chatController.muteChat, { user: { id: I }, params: { matchId: match.id }, body: { duration: '8h' } });
  check('mute', r.status === 200 && new Date(r.body.muted_until) > new Date());
  r = await call(matchController.getMatches, { user: { id: I, role: 'influencer' }, query: {} });
  check('chat list shows it muted', !!r.body.data.find((m) => m.match_id === match.id)?.muted_until);
  r = await call(chatController.muteChat, { user: { id: I }, params: { matchId: match.id }, body: { duration: null } });
  check('unmute', r.status === 200 && r.body.muted_until === null);

  // ── Clear chat ─────────────────────────────────────────────────
  r = await call(chatController.clearChat, { user: { id: I }, params: { matchId: match.id } });
  check('clear chat', r.status === 200 && !!r.body.cleared_at);
  await sleep(5);
  await emit(brandC, 'send_message', { matchId: match.id, content: 'after the clear' });
  r = await call(chatController.getMessages, { user: { id: I }, params: { matchId: match.id }, query: {} });
  check('a cleared chat only shows what came after', r.body.data.length === 1 && r.body.data[0].content === 'after the clear', JSON.stringify(r.body.data.map((m) => m.content)));
  r = await call(chatController.getMessages, { user: { id: B }, params: { matchId: match.id }, query: {} });
  check('clearing is only for me', r.body.data.length > 1);

  // ── Account deletion takes the chat files with it ──────────────
  const { removeUserChatMedia } = require(`${BACKEND}/src/utils/chatStorage`);
  await removeUserChatMedia(fakeAdmin, B);
  check('account deletion removes every chat file the user sent', ![...objects.keys()].some((p) => p.startsWith(`${B}/`)));
  await pg.query('DELETE FROM users WHERE id = $1', [B2]);
  const { rows: [{ n: orphans }] } = await pg.query('SELECT count(*)::int AS n FROM messages WHERE id = $1', [offlineMsgId]);
  check('deleting an account deletes its messages', orphans === 0);

  for (const c of clients) c.disconnect();
  await closeSocket();

  // ── Encryption without a key (production) ──────────────────────
  const encPath = require.resolve(`${BACKEND}/src/utils/encryption`);
  const devEncrypted = await require(encPath).encrypt('legacy secret');
  delete require.cache[encPath];
  process.env.NODE_ENV = 'production';
  const prodNoKey = require(encPath);
  check('production without a key stores plaintext instead of failing the send',
    prodNoKey.encryptionStatus() === 'disabled' && (await prodNoKey.encrypt('hi at 10:30')) === 'hi at 10:30');
  check('plaintext with colons is not mistaken for ciphertext', (await prodNoKey.decrypt('a:b:c')) === 'a:b:c');
  check('messages from the old public-key fallback stay readable', (await prodNoKey.decrypt(devEncrypted)) === 'legacy secret');
  delete require.cache[encPath];
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  const prodKey = require(encPath);
  const sealed = await prodKey.encrypt('real secret');
  check('with a key, production encrypts', prodKey.encryptionStatus() === 'configured' && prodKey.isCiphertext(sealed) && (await prodKey.decrypt(sealed)) === 'real secret');
  check('...and still reads old public-key rows', (await prodKey.decrypt(devEncrypted)) === 'legacy secret');

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
}

main()
  .then(() => process.exit(failures ? 1 : 0))
  .catch((e) => { console.error(e); process.exit(1); });
