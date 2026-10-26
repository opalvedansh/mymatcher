// Attacker's-eye checks: boots the real API (HTTP + socket.io) on an
// in-process Postgres (PGlite) with every migration, signs real tokens for an
// attacker and two victims, and tries to cross every boundary between them.
// Each line is PASS when the attack is refused. Run with
// `node tests/integration/security.js` (part of `npm run test:integration`).
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const BACKEND = path.resolve(__dirname, '../..');
const SECRET = 'security-test-secret-at-least-32-characters-long';
Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '0',
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_JWT_SECRET: SECRET,
});

let pg;
const dbShim = {
  query: (text, params) => pg.query(text, params),
  getClient: async () => ({ query: (t, p) => pg.query(t, p), release() {} }),
  pool: { end() {} },
};
require.cache[`${BACKEND}/src/config/db.js`] = {
  id: 'db', filename: `${BACKEND}/src/config/db.js`, loaded: true, exports: dbShim, children: [], paths: [],
};
const bucketSettings = {};
const storageStub = {
  createBucket: async (name, settings) => { bucketSettings[name] = settings; return {}; },
  updateBucket: async () => ({}),
  from: () => ({
    createSignedUploadUrl: async (p) => ({ data: { signedUrl: `https://proj.supabase.co/upload/${p}`, token: 't' }, error: null }),
    createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null }),
    info: async () => ({ data: { size: 10, metadata: { mimetype: 'image/jpeg' } }, error: null }),
    list: async () => ({ data: [], error: null }),
    remove: async () => ({ error: null }),
    copy: async () => ({ error: null }),
  }),
};
require.cache[`${BACKEND}/src/config/supabaseAdmin.js`] = {
  id: 'sa', filename: `${BACKEND}/src/config/supabaseAdmin.js`, loaded: true,
  exports: { getSupabaseAdmin: () => ({ storage: storageStub, auth: { admin: { deleteUser: async () => ({ error: null }) } } }) },
  children: [], paths: [],
};

let failures = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

const token = (sub, opts = {}) => jwt.sign({ sub, email: `${sub}@x.com`, aud: 'authenticated', role: 'authenticated' }, opts.secret || SECRET, { algorithm: 'HS256', expiresIn: opts.exp || '1h' });

(async () => {
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

  // ── Cast ─────────────────────────────────────────────────────
  // ATK: attacker (influencer). VB: victim brand. VI: victim influencer.
  // VB and VI are matched and chatting; VB has blocked ATK; VB posts a
  // close-friends story visible to VI only.
  const ATK = 'attacker', VB = 'victim-brand', VI = 'victim-infl', ADM = 'admin-user';
  const STORAGE = 'https://proj.supabase.co/storage/v1/object/public/public/uploads';
  await pg.exec(`
    INSERT INTO users (id, email, role) VALUES
      ('${ATK}', 'a@x.com', 'influencer'), ('${VB}', 'vb@x.com', 'brand'),
      ('${VI}', 'vi@x.com', 'influencer'), ('${ADM}', 'adm@x.com', 'brand');
    INSERT INTO brand_profiles (user_id, name, categories, lat, lng) VALUES
      ('${VB}', 'Victim Brand', '{fashion}', 28.6139, 77.2090), ('${ADM}', 'Admin', '{fashion}', 0, 0);
    INSERT INTO influencer_profiles (user_id, name, categories, lat, lng) VALUES
      ('${ATK}', 'Mallory', '{fashion}', 28.6, 77.2), ('${VI}', 'Victim Creator', '{fashion}', 28.61, 77.21);
    INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${VB}', '${ATK}');
    INSERT INTO close_friends (user_id, friend_id) VALUES ('${VB}', '${VI}');
    INSERT INTO admin_users (user_id, email, role) VALUES ('${ADM}', 'adm@x.com', 'superadmin');
  `);
  const { rows: [{ id: MATCH }] } = await pg.query(`INSERT INTO matches (brand_id, influencer_id) VALUES ($1, $2) RETURNING id`, [VB, VI]);
  await pg.query(`INSERT INTO messages (match_id, sender_id, content) VALUES ($1, $2, 'secret deal: 50k')`, [MATCH, VB]);
  const { rows: [{ id: POST }] } = await pg.query(`INSERT INTO posts (user_id, image_url, caption) VALUES ($1, $2, 'hi') RETURNING id`, [VI, `${STORAGE}/${VI}/p.jpg`]);
  const { rows: [{ id: COMMENT }] } = await pg.query(`INSERT INTO post_comments (post_id, user_id, body) VALUES ($1, $2, 'mine') RETURNING id`, [POST, VI]);
  const { rows: [{ id: CF_STORY }] } = await pg.query(`INSERT INTO stories (user_id, media_url, audience) VALUES ($1, $2, 'close_friends') RETURNING id`, [VB, `${STORAGE}/${VB}/s.jpg`]);
  const { rows: [{ id: VB_POST }] } = await pg.query(`INSERT INTO posts (user_id, image_url) VALUES ($1, $2) RETURNING id`, [VB, `${STORAGE}/${VB}/b.jpg`]);
  await pg.query(`INSERT INTO notifications (user_id, type, actor_id, title) VALUES ($1, 'new_like', $2, 'like')`, [VI, VB]);

  const server = require(`${BACKEND}/src/app`);
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = (who) => ({ Authorization: `Bearer ${token(who)}` });
  const req = async (method, url, who, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(who ? as(who) : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    const text = await res.text();
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text };
  };
  const denied = (r) => r.status >= 400 && r.status < 500;
  const one = async (sql, params) => (await pg.query(sql, params)).rows[0];

  // ── Authentication ───────────────────────────────────────────
  check('no token is refused', (await req('GET', '/api/matches')).status === 401);
  check('token signed with a guessed secret is refused',
    (await req('GET', '/api/matches', null, undefined, { Authorization: `Bearer ${token(VB, { secret: 'anon' })}` })).status === 401);
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: VB, aud: 'authenticated' })).toString('base64url')}.`;
  check('alg:none token is refused', (await req('GET', '/api/matches', null, undefined, { Authorization: `Bearer ${none}` })).status === 401);
  check('expired token is refused',
    (await req('GET', '/api/matches', null, undefined, { Authorization: `Bearer ${token(VB, { exp: -60 })}` })).status === 401);
  const wrongAud = jwt.sign({ sub: VB, aud: 'anon' }, SECRET, { algorithm: 'HS256' });
  check('token for another audience is refused', (await req('GET', '/api/matches', null, undefined, { Authorization: `Bearer ${wrongAud}` })).status === 401);

  // ── Someone else's conversation ──────────────────────────────
  check('attacker cannot open a match they are not in', denied(await req('GET', `/api/matches/${MATCH}`, ATK)));
  const msgs = await req('GET', `/api/chat/${MATCH}/messages`, ATK);
  check('attacker cannot read the victims\' messages', denied(msgs) && !msgs.text.includes('secret deal'));
  check('attacker cannot get an upload slot in their chat', denied(await req('POST', `/api/chat/${MATCH}/uploads`, ATK, { kind: 'image', mime: 'image/jpeg', size: 10, name: 'a.jpg' })));
  await req('POST', `/api/chat/${MATCH}/clear`, ATK, {});
  check('attacker cannot clear their chat', (await one('SELECT count(*)::int AS n FROM messages WHERE match_id = $1', [MATCH])).n === 1);
  check('attacker cannot mute their chat', denied(await req('PUT', `/api/chat/${MATCH}/mute`, ATK, { duration: 'always' })));
  await req('DELETE', `/api/matches/${MATCH}`, ATK);
  check('attacker cannot unmatch them', (await one('SELECT status FROM matches WHERE id = $1', [MATCH])).status === 'active');

  // ── Someone else's content ───────────────────────────────────
  await req('DELETE', `/api/posts/${POST}`, ATK);
  check('attacker cannot delete another user\'s post', !!(await one('SELECT id FROM posts WHERE id = $1', [POST])));
  await req('DELETE', `/api/posts/${POST}/comments/${COMMENT}`, ATK);
  check('attacker cannot delete another user\'s comment', !!(await one('SELECT id FROM post_comments WHERE id = $1', [COMMENT])));
  check('attacker cannot post someone else\'s photo', denied(await req('POST', '/api/posts', ATK, { image_url: `${STORAGE}/${VI}/p.jpg` })));
  check('attacker cannot post a path-escaping photo URL', denied(await req('POST', '/api/posts', ATK, { image_url: `${STORAGE}/${ATK}/..%2F${VI}%2Fp.jpg` })));
  check('attacker cannot post an off-site image (tracking pixel)', denied(await req('POST', '/api/posts', ATK, { image_url: 'https://evil.example/pixel.gif' })));
  const pre = await one('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [VI]);
  await req('POST', '/api/notifications/read', ATK, {});
  check('attacker cannot mark the victim\'s notifications read',
    (await one('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [VI])).n === pre.n);

  // ── Stories and blocks ───────────────────────────────────────
  check('attacker cannot list who viewed the victim\'s story', denied(await req('GET', `/api/stories/${CF_STORY}/viewers`, ATK)));
  const view = await req('POST', `/api/stories/${CF_STORY}/view`, ATK, {});
  check('blocked attacker cannot mark a close-friends story as viewed',
    !(await one('SELECT 1 AS x FROM story_views WHERE story_id = $1 AND viewer_id = $2', [CF_STORY, ATK])), `status ${view.status}`);
  const feed = await req('GET', '/api/stories/feed', ATK);
  check('close-friends story is not in the attacker\'s story feed', !feed.text.includes(CF_STORY));
  check('blocked attacker cannot open the blocker\'s profile', (await req('GET', `/api/profiles/${VB}`, ATK)).status === 404);
  check('blocked attacker cannot open the blocker\'s post', denied(await req('GET', `/api/posts/${VB_POST}`, ATK)));
  const prof = await req('GET', `/api/profiles/${VI}`, ATK);
  check('profiles never leak email or exact location',
    prof.status === 200 && !('email' in prof.body) && !('lat' in prof.body) && !('lng' in prof.body), JSON.stringify(Object.keys(prof.body || {})).slice(0, 200));
  await req('POST', '/api/swipes', ATK, { swiped_id: VB, direction: 'like' });
  await pg.query(`INSERT INTO swipes (swiper_id, swiped_id, direction) VALUES ($1, $2, 'like') ON CONFLICT DO NOTHING`, [VB, ATK]);
  await req('POST', '/api/swipes', ATK, { swiped_id: VB, direction: 'like' });
  check('blocked attacker cannot force a match with the blocker',
    !(await one('SELECT 1 AS x FROM matches WHERE brand_id = $1 AND influencer_id = $2', [VB, ATK])));
  check('attacker cannot swipe on themselves', denied(await req('POST', '/api/swipes', ATK, { swiped_id: ATK, direction: 'like' })));

  // ── Privilege escalation ─────────────────────────────────────
  await req('PUT', '/api/profiles/me', ATK, { verified: true, followers: 999999999, engagement_rate: 99, user_id: VI, role: 'brand', banned: false });
  const me = await one('SELECT verified, followers, engagement_rate FROM influencer_profiles WHERE user_id = $1', [ATK]);
  check('attacker cannot self-verify or fake follower stats', !me.verified && Number(me.followers || 0) < 999999999 && Number(me.engagement_rate || 0) !== 99, JSON.stringify(me));
  check('victim\'s profile untouched by attacker\'s update', (await one('SELECT name FROM influencer_profiles WHERE user_id = $1', [VI])).name === 'Victim Creator');
  await req('POST', '/api/auth/sync', ATK, { role: 'brand' });
  check('attacker cannot switch role after sign-up', (await one('SELECT role FROM users WHERE id = $1', [ATK])).role === 'influencer');
  check('attacker cannot use the admin API', denied(await req('GET', '/api/admin/users', ATK)));
  check('attacker cannot ban a user through the admin API', denied(await req('POST', `/api/admin/users/${VI}/ban`, ATK, { reason: 'x' })));
  check('admin API does work for a real admin (control)', (await req('GET', '/api/admin/users', ADM)).status === 200);
  check('attacker cannot rate a brand they never matched', denied(await req('PUT', `/api/ratings/${VB}`, ATK, { score: 1 })));
  check('attacker cannot review a creator (wrong role, no match)', denied(await req('PUT', `/api/reviews/${VI}`, ATK, { quote: 'terrible terrible', reviewer_name: 'x' })));

  // ── Injection and XSS ────────────────────────────────────────
  check('SQL injection in a path id is rejected', denied(await req('GET', `/api/matches/${encodeURIComponent("' OR 1=1--")}`, ATK)));
  await req('PUT', '/api/profiles/me', ATK, { bio: "'); DROP TABLE users; --" });
  check('SQL injection in a profile field is stored as text', !!(await one('SELECT 1 AS x FROM users LIMIT 1')));
  await pg.query(`UPDATE posts SET caption = '<script>alert(document.cookie)</script><img src=x onerror=alert(1)>' WHERE id = $1`, [POST]);
  const share = await req('GET', `/p/${POST}`, null);
  check('stored script in a caption is escaped on the public share page', !share.text.includes('<script>alert') && !share.text.includes('<img src=x'));
  const csp = (await fetch(`${base}/p/${POST}`)).headers.get('content-security-policy') || '';
  check('share page forbids scripts (CSP)', /default-src 'none'/.test(csp) && !/script-src/.test(csp), csp);

  // ── Abuse and SSRF ───────────────────────────────────────────
  check('push subscription to an internal address is refused', denied(await req('PUT', '/api/auth/web-push', ATK, { endpoint: 'https://169.254.169.254/latest/meta-data', keys: { p256dh: 'k', auth: 'a' } })));
  const big = await req('PUT', '/api/profiles/me', ATK, { bio: 'x'.repeat(200000) });
  check('oversized request bodies are refused', big.status === 413);
  const uploadBody = { filename: 'a.html', contentType: 'text/html' };
  check('upload slot for HTML is refused', denied(await req('POST', '/api/upload/presigned-url', ATK, uploadBody)));
  await req('POST', '/api/upload/presigned-url', ATK, { filename: 'a.jpg', contentType: 'image/jpeg' });
  const pub = bucketSettings.public || {};
  check('public upload bucket enforces a size cap and image/video types only',
    pub.fileSizeLimit > 0 && pub.fileSizeLimit <= 50 * 1024 * 1024 && !pub.allowedMimeTypes?.some((t) => /html|svg|javascript/.test(t)), JSON.stringify(pub));
  check('upload slot for SVG is refused', denied(await req('POST', '/api/upload/presigned-url', ATK, { filename: 'a.svg', contentType: 'image/svg+xml' })));

  // ── Realtime chat (socket.io) ────────────────────────────────
  const { io } = require('socket.io-client');
  const connect = (auth) => new Promise((resolve) => {
    const s = io(base, { auth, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve({ s, ok: true }));
    s.on('connect_error', (e) => resolve({ s, ok: false, err: e.message }));
  });
  const anon = await connect({});
  check('socket without a token is refused', !anon.ok);
  anon.s.close();
  const atk = await connect({ token: token(ATK) });
  check('attacker can open their own socket (control)', atk.ok, atk.err || '');
  const emit = (ev, ...args) => new Promise((r) => { atk.s.timeout(3000).emit(ev, ...args, (err, res) => r(err ? { timeout: true } : res)); });
  const joined = await emit('join_match', MATCH);
  check('attacker cannot join the victims\' chat room', !joined || joined.ok === false || joined.error, JSON.stringify(joined));
  const sent = await emit('send_message', { matchId: MATCH, content: 'injected', clientId: 'c1' });
  check('attacker cannot send a message into the victims\' chat',
    !(await one(`SELECT 1 AS x FROM messages WHERE match_id = $1 AND content = 'injected'`, [MATCH])), JSON.stringify(sent));
  const swapped = await emit('refresh_token', token(VB));
  check('attacker cannot swap their socket onto the victim\'s identity', swapped?.ok !== true, JSON.stringify(swapped));
  atk.s.close();

  console.log(failures ? `\n${failures} attack(s) got through` : '\nAll attacks refused');
  server.close();
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
