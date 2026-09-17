// Scale-path checks against a real Redis (redis-memory-server) and an
// in-process Postgres (PGlite + PostGIS):
//   - precomputed feed decks page exactly like the direct ranking query
//   - Redis-backed rate limits survive Redis starting after the API
//   - two chat instances share rooms; the API reaches them via the emitter
//   - bans, blocks and retries behave on the chat path
//   - the worker precomputes decks
// Run with `npm run test:integration`.
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

const BACKEND = path.resolve(__dirname, '../..');

let failures = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(50);
  }
  return false;
}
function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}
function stub(rel, exports) {
  const filename = `${BACKEND}/${rel}`;
  require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] };
}
function forget(rel) {
  delete require.cache[`${BACKEND}/${rel}`];
}

// ── Environment: must be set before any backend module loads ─────
process.env.NODE_ENV = 'development';
process.env.LOG_LEVEL = 'silent';
process.env.SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.FEED_DECK_SIZE = '7';
process.env.SOCKET_SWEEP_INTERVAL_MS = '3600000';

let pg;
let rankingQueries = 0;
stub('src/config/db.js', {
  query: (text, params) => {
    if (/relevance_score/.test(text) && !/ANY\(\$15/.test(text)) rankingQueries++;
    return pg.query(text, params);
  },
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
  sendChatNotification: async (to, from) => { pushes.push({ to, from }); },
});
stub('src/config/supabaseAdmin.js', { getSupabaseAdmin: () => ({}) });

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
  const { RedisMemoryServer } = require('redis-memory-server');
  const redisPort = await freePort();
  process.env.REDIS_URL = `redis://127.0.0.1:${redisPort}`;

  // ── 1. Rate limits: the store is created while Redis is still down ──
  const express = require('express');
  const { rateLimit } = require('express-rate-limit');
  const { redisStore, limiterDefaults } = require(`${BACKEND}/src/config/rateLimitStore`);
  const redisClient = require(`${BACKEND}/src/config/redis`);
  const limitedApp = express();
  limitedApp.use(rateLimit({ store: redisStore('rl:test:'), windowMs: 60000, limit: 3, ...limiterDefaults }));
  limitedApp.get('/', (_req, res) => res.json({ ok: true }));
  const limitedServer = limitedApp.listen(0);
  const limitedUrl = `http://127.0.0.1:${limitedServer.address().port}/`;
  const statusOf = () => fetch(limitedUrl).then((r) => r.status);

  await sleep(300);
  const redis = await RedisMemoryServer.create({ autoStart: true, instance: { port: redisPort } });
  check('test Redis started on the port the API was configured with', (await redis.getPort()) === redisPort);
  check('Redis client connects after a late Redis start', await waitFor(() => redisClient.status === 'ready', 20000));

  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push(await statusOf());
  check('rate limit enforced through Redis despite the failed boot-time script load',
    JSON.stringify(statuses) === '[200,200,200,429,429]', JSON.stringify(statuses));
  check('limit counter lives in Redis', (await redisClient.keys('rl:test:*')).length === 1);

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

  // One brand and 30 influencers. Few distinct scores, so ties are common
  // and the id tie-break matters; mixed-case ids exercise collation.
  const B = 'brand-1';
  const infl = [];
  let values = `('${B}', 'b@x.com', 'brand')`;
  let profiles = '';
  for (let i = 0; i < 30; i++) {
    const id = `${i % 2 ? 'Inf' : 'inf'}-${String(i).padStart(2, '0')}-${(i * 7919 % 97).toString(36)}`;
    infl.push(id);
    values += `, ('${id}', '${id}@x.com', 'influencer')`;
    const cat = i % 3 === 0 ? 'fashion' : 'tech';
    const complete = i % 4 === 0;
    profiles += `${profiles ? ',' : ''}('${id}', 'n${i}', ${complete ? "'bio', 'a'" : 'NULL, NULL'}, '{${cat}}', ${i % 5 === 0 ? 200 : 5000}, ${i % 5 === 0 ? 500 : 9000})`;
  }
  await pg.exec(`
    INSERT INTO users (id, email, role) VALUES ${values};
    INSERT INTO brand_profiles (user_id, name, categories, budget_min, budget_max)
      VALUES ('${B}', 'Brand', '{fashion}', 100, 1000);
    INSERT INTO influencer_profiles (user_id, name, bio, avatar_url, categories, price_min, price_max) VALUES ${profiles};
  `);

  // ── 2. Feed decks ──────────────────────────────────────────────
  const ranking = require(`${BACKEND}/src/services/feedRanking`);
  const { getFeed } = require(`${BACKEND}/src/controllers/feedController`);
  const sharedCache = require(`${BACKEND}/src/utils/sharedCache`);
  const brand = { id: B, role: 'brand' };

  const truth = (await ranking.scoreCandidates(await ranking.loadContext(B, 'brand'), { limit: 1000 })).map((r) => r.id);
  check('ground truth ranks all 30 influencers', truth.length === 30);

  async function pageAll(limit, onPage) {
    const seen = [];
    let q = { limit: String(limit) };
    for (let n = 0; n < 50; n++) {
      const r = await call(getFeed, { user: brand, query: q });
      if (r.status !== 200) throw r.err;
      seen.push(...r.body.data.map((x) => x.id));
      if (onPage) await onPage(r.body.data);
      if (r.body.next_cursor_id == null) break;
      q = { limit: String(limit), cursor_score: String(r.body.next_cursor_score), cursor_id: r.body.next_cursor_id };
    }
    return seen;
  }

  rankingQueries = 0;
  let seen = await pageAll(4);
  check('deck paging returns exactly the ranking order (deck of 7, pages of 4)', JSON.stringify(seen) === JSON.stringify(truth), `\n  got  ${seen}\n  want ${truth}`);
  check('scoring ran once per deck, not once per page', rankingQueries <= Math.ceil(30 / 7) + 1, `ranking queries: ${rankingQueries}`);
  check('deck is stored in Redis', (await redisClient.exists(`feed:deck:${B}`)) === 1);

  // Pages served by another instance: build a top-of-feed deck, then drop
  // this process's local cache so only Redis can supply it.
  let r = await call(getFeed, { user: brand, query: { limit: '3' } });
  sharedCache._local.flush();
  rankingQueries = 0;
  r = await call(getFeed, { user: brand, query: { limit: '3' } });
  check('a deck in Redis serves the first page without re-ranking', rankingQueries === 0 && r.body.data[0].id === truth[0], `ranking queries: ${rankingQueries}`);

  // Swipe while paging: nothing swiped may appear again, nothing else is lost.
  await sharedCache.del(`feed:deck:${B}`);
  const swiped = new Set();
  seen = await pageAll(5, async (rows) => {
    for (const row of rows.slice(0, 2)) {
      swiped.add(row.id);
      await pg.query(`INSERT INTO swipes (swiper_id, swiped_id, direction) VALUES ($1, $2, 'reject')`, [B, row.id]);
    }
  });
  check('paging while swiping still visits every candidate once', JSON.stringify(seen) === JSON.stringify(truth));
  seen = await pageAll(5);
  check('restarting from the top skips swiped profiles and keeps the rest in order',
    JSON.stringify(seen) === JSON.stringify(truth.filter((id) => !swiped.has(id))),
    `${seen.length} vs ${truth.length - swiped.size}`);

  // Block + unblock through the real controllers.
  const safety = require(`${BACKEND}/src/controllers/safetyController`);
  const target = seen[0];
  await call(safety.blockUser, { user: { id: B }, body: { user_id: target } });
  seen = await pageAll(5);
  check('blocked profile disappears from the deck', !seen.includes(target));
  await call(safety.unblockUser, { user: { id: B }, params: { userId: target } });
  seen = await pageAll(5);
  check('unblocked profile returns to the deck', seen[0] === target);

  // Weight change: every deck is rebuilt with the new weights.
  await pg.exec(`INSERT INTO admin_settings (key, value) VALUES ('algorithm_weights', '{"CATEGORY_OVERLAP":0,"BUDGET_FIT":0,"LOCATION_MATCH":0,"COMPLETENESS":100}')
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await ranking.invalidateWeights();
  r = await call(getFeed, { user: brand, query: { limit: '3' } });
  check('new admin weights take effect immediately', r.body.scoring.weights.COMPLETENESS === 100 && Number(r.body.data[0].relevance_score) === 100, JSON.stringify(r.body.data.map((x) => x.relevance_score)));

  // ── 3. Worker precomputes decks ────────────────────────────────
  const queue = require(`${BACKEND}/src/config/queue`);
  const feedDeck = require(`${BACKEND}/src/services/feedDeck`);
  queue.startWorkers();
  await feedDeck.refreshAfterProfileChange(B, 'brand');
  check('profile change drops the old deck', (await redisClient.exists(`feed:deck:${B}`)) === 0);
  check('worker rebuilds the deck in the background', await waitFor(async () => (await redisClient.exists(`feed:deck:${B}`)) === 1, 10000));

  // ── 4. Chat across two instances ───────────────────────────────
  const I = infl[0];
  const X = infl[1]; // not in the match
  const { rows: [match] } = await pg.query(
    `INSERT INTO matches (brand_id, influencer_id) VALUES ($1, $2) RETURNING id`, [B, I]);

  async function startChat() {
    forget('src/socket.js');
    forget('src/realtime/index.js');
    const { initSocket, closeSocket, _sweep } = require(`${BACKEND}/src/socket`);
    const server = http.createServer();
    initSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
    return { url: `http://127.0.0.1:${server.address().port}`, closeSocket, sweep: _sweep };
  }
  const chatA = await startChat();
  const chatB = await startChat();
  // What the API process uses: no socket server, so the Redis emitter.
  forget('src/realtime/index.js');
  forget('src/utils/sessions.js');
  forget('src/controllers/safetyController.js');
  // Loaded fresh and never given a server, so it must use the Redis emitter.
  require(`${BACKEND}/src/realtime`);
  const { endSessions } = require(`${BACKEND}/src/utils/sessions`);
  const apiSafety = require(`${BACKEND}/src/controllers/safetyController`);
  await sleep(500); // adapters subscribe

  const { io } = require('socket.io-client');
  const clients = [];
  function connect(url, token) {
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

  const bad = await connect(chatA.url, 'bad-token');
  check('invalid token is refused', !!bad.error);

  const brandC = await connect(chatA.url, B);
  const inflC = await connect(chatB.url, I);
  const outsider = await connect(chatB.url, X);
  check('both participants connect (to different instances)', !brandC.error && !inflC.error, brandC.error || inflC.error);

  let ack = await inflC.socket.emitWithAck('join_match', match.id);
  check('participant joins the match room', ack.ok === true, JSON.stringify(ack));
  ack = await outsider.socket.emitWithAck('join_match', match.id);
  check('non-participant cannot join', ack.ok === false);

  ack = await brandC.socket.emitWithAck('send_message', { matchId: match.id, content: 'hello', clientId: 'c-1' });
  check('send is acked with the stored message', ack.ok && ack.message.content === 'hello' && ack.message.client_msg_id === 'c-1', JSON.stringify(ack));
  check('message reaches the other instance', await waitFor(() => got(inflC, 'receive_message').length === 1));
  check('push notification sent to the receiver', pushes.some((p) => p.to === I && p.from === B));

  const retry = await brandC.socket.emitWithAck('send_message', { matchId: match.id, content: 'hello', clientId: 'c-1' });
  await sleep(300);
  const { rows: [{ n }] } = await pg.query(`SELECT count(*)::int AS n FROM messages WHERE match_id = $1`, [match.id]);
  check('retried send is stored once and returns the original', retry.ok && retry.duplicate && retry.message.id === ack.message.id && n === 1, JSON.stringify({ retry, n }));
  check('retried send is not delivered twice', got(inflC, 'receive_message').length === 1);

  ack = await brandC.socket.emitWithAck('send_message', { matchId: match.id, content: 'x'.repeat(2001) });
  check('oversized message rejected', ack.ok === false && ack.error === 'too_long');
  ack = await outsider.socket.emitWithAck('send_message', { matchId: match.id, content: 'spam' });
  check('non-participant cannot send', ack.ok === false && ack.error === 'not_found');

  outsider.socket.emit('typing', { matchId: match.id, isTyping: true });
  brandC.socket.emit('typing', { matchId: match.id, isTyping: true });
  await sleep(300);
  check('typing only relayed from admitted participants', got(inflC, 'typing').length === 1 && got(inflC, 'typing')[0].payload.userId === B);

  const burst = await Promise.all(Array.from({ length: 25 }, (_, i) =>
    inflC.socket.emitWithAck('send_message', { matchId: match.id, content: `m${i}` })));
  const limited = burst.filter((a) => a.error === 'rate_limited').length;
  check('message flood is rate limited per connection', limited >= 4 && burst.filter((a) => a.ok).length <= 21, `limited ${limited}`);

  const refresh = await brandC.socket.emitWithAck('refresh_token', I);
  check('refresh_token for a different user is refused', refresh.ok === false);

  // Block via the API process: both instances drop the conversation.
  await call(apiSafety.blockUser, { user: { id: I }, body: { user_id: B } });
  check('block (sent from the API via the Redis emitter) closes the chat on both instances',
    await waitFor(() => got(brandC, 'match_closed').length === 1 && got(inflC, 'match_closed').length === 1));
  ack = await brandC.socket.emitWithAck('send_message', { matchId: match.id, content: 'still there?' });
  check('no sends into a closed match (membership cache cleared)', ack.ok === false && ack.error === 'not_found');

  // Ban through the API (emitter) disconnects on another instance.
  await pg.query(`UPDATE users SET banned = true WHERE id = $1`, [I]);
  await endSessions([I]);
  check('ban via API disconnects the user on another instance', await waitFor(() => !inflC.socket.connected));
  const banned = await connect(chatA.url, I);
  check('banned user cannot reconnect', banned.error === 'Authentication error: Account suspended', banned.error);

  // The periodic sweep catches bans made without the API (e.g. in SQL).
  const x2 = await connect(chatA.url, X);
  await pg.query(`UPDATE users SET banned = true WHERE id = $1`, [X]);
  await chatA.sweep();
  check('sweep disconnects users banned directly in the database',
    await waitFor(() => !x2.socket.connected) && got(x2, 'session_ended')[0]?.payload.reason === 'banned');

  for (const c of clients) c.disconnect();
  await chatA.closeSocket();
  await chatB.closeSocket();
  await queue.stopWorkers();

  // ── 5. Redis outage: degrade, don't fail ───────────────────────
  await redis.stop();
  await waitFor(() => redisClient.status !== 'ready');
  const down = [];
  for (let i = 0; i < 3; i++) down.push(await statusOf());
  check('rate-limited routes still answer while Redis is down', down.every((st) => st === 200), JSON.stringify(down));
  r = await call(getFeed, { user: brand, query: { limit: '3' } });
  check('feed still served from Postgres while Redis is down', r.status === 200 && r.body.data.length === 3, r.err?.message || '');

  limitedServer.close();
  redisClient.disconnect();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
}

main()
  .then(() => process.exit(failures ? 1 : 0))
  .catch((e) => { console.error(e); process.exit(1); });
