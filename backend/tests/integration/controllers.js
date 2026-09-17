// Integration checks: runs every migration on an in-process Postgres
// (PGlite + PostGIS), then exercises the real controllers against it.
// Run with `npm run test:integration`.
const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '../..');
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://proj.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';

let pg;
const dbShim = {
  query: (text, params) => pg.query(text, params),
  getClient: async () => ({ query: (t, p) => pg.query(t, p), release() {} }),
  pool: { end() {} },
};
require.cache[`${BACKEND}/src/config/db.js`] = {
  id: 'db', filename: `${BACKEND}/src/config/db.js`, loaded: true, exports: dbShim, children: [], paths: [],
};


const removed = [];
const deletedAuthUsers = [];
const adminStub = {
  storage: { from: () => ({
    list: async (folder) => ({ data: removed.includes(folder) ? [] : [{ id: '1', name: 'a.jpg' }, { id: null, name: 'sub' }], error: null }),
    remove: async (paths) => { removed.push(paths[0].split('/').slice(0, 2).join('/')); return { error: null }; },
  }) },
  auth: { admin: { deleteUser: async (id) => { deletedAuthUsers.push(id); return { error: null }; } } },
};
require.cache[`${BACKEND}/src/config/supabaseAdmin.js`] = {
  id: 'sa', filename: `${BACKEND}/src/config/supabaseAdmin.js`, loaded: true, exports: { getSupabaseAdmin: () => adminStub }, children: [], paths: [],
};
const disconnected = [];
require.cache[`${BACKEND}/src/socket.js`] = {
  id: 'sock', filename: `${BACKEND}/src/socket.js`, loaded: true, children: [], paths: [],
  exports: { getIO: () => ({ in: (room) => ({ disconnectSockets: () => disconnected.push(room) }) }) },
};

let failures = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
      setHeader() {},
    };
    handler({ query: {}, params: {}, body: {}, headers: {}, ...req }, res, (err) =>
      resolve({ status: 'next', err }));
  });
}

async function main() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { postgis } = await import('@electric-sql/pglite-postgis');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { uuid_ossp } = await import('@electric-sql/pglite/contrib/uuid_ossp');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  pg = await PGlite.create({ extensions: { postgis, pg_trgm, uuid_ossp, pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

  // ── Migrations ───────────────────────────────────────────────
  const dir = `${BACKEND}/migrations`;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await pg.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      check(`migration ${file}`, false, err.message);
      await pg.exec('ROLLBACK').catch(() => {});
    }
  }
  check('all migrations apply', failures === 0);

  // ── Seed ─────────────────────────────────────────────────────
  const B = 'brand-1', I1 = 'infl-1', I2 = 'infl-2';
  await pg.exec(`
    INSERT INTO users (id, email, role) VALUES
      ('${B}', 'b@x.com', 'brand'), ('${I1}', 'i1@x.com', 'influencer'), ('${I2}', 'i2@x.com', 'influencer');
    INSERT INTO brand_profiles (user_id, name, categories, lat, lng, budget_min, budget_max)
      VALUES ('${B}', 'Brand', '{fashion}', 28.6139, 77.2090, 100, 1000);
    INSERT INTO influencer_profiles (user_id, name, bio, avatar_url, categories, lat, lng, price_min, price_max)
      VALUES ('${I1}', 'Near', 'bio', 'a', '{fashion}', 28.62, 77.21, 200, 500),
             ('${I2}', 'Far',  NULL, NULL, '{tech}',    19.07, 72.87, 5000, 9000);
  `);

  // ── Feed ─────────────────────────────────────────────────────
  const { getFeed } = require(`${BACKEND}/src/controllers/feedController`);
  let r = await call(getFeed, { user: { id: B, role: 'brand' } });
  check('brand feed returns 200', r.status === 200, r.err?.message || '');
  const rows = r.body?.data || [];
  check('brand feed ranks near/matching influencer first', rows[0]?.id === I1, JSON.stringify(rows.map((x) => [x.id, x.relevance_score])));
  check('feed rows carry no exact coordinates', rows.every((x) => !('lat' in x) && !('lng' in x)));
  check('feed distance is bucketed to 5 km', rows.every((x) => x.dist_km === null || Number(x.dist_km) % 5 === 0), JSON.stringify(rows.map((x) => x.dist_km)));

  await pg.exec(`INSERT INTO admin_settings (key, value) VALUES ('algorithm_weights', '{"CATEGORY_OVERLAP":"1.5","BUDGET_FIT":"x"}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  require(`${BACKEND}/src/config/cache`).feedCache.flush();
  r = await call(getFeed, { user: { id: B, role: 'brand' } });
  check('decimal / junk admin weights no longer break the feed', r.status === 200, r.err?.message || '');

  r = await call(getFeed, { user: { id: I1, role: 'influencer' } });
  check('influencer feed returns 200 with brands', r.status === 200 && r.body.data[0]?.id === B, r.err?.message || '');

  // ── Profiles ─────────────────────────────────────────────────
  const profiles = require(`${BACKEND}/src/controllers/profileController`);
  r = await call(profiles.getProfileById, { user: { id: B, role: 'brand' }, params: { userId: I1 } });
  check('public profile hides email and coordinates', r.status === 200 && !('email' in r.body) && !('lat' in r.body) && r.body.name === 'Near', JSON.stringify(Object.keys(r.body || {})));
  r = await call(profiles.getMyProfile, { user: { id: I1, role: 'influencer' } });
  check('own profile still includes email and coordinates', r.body?.email === 'i1@x.com' && r.body?.lat != null);

  r = await call(profiles.updateMyProfile, {
    user: { id: I1, role: 'influencer' },
    body: { bio: 'new bio', verified: true, followers: 99999999, engagement_rate: 99, avg_views: 5 },
  });
  const { rows: [ip] } = await pg.query(`SELECT bio, verified, followers, engagement_rate, avg_views FROM influencer_profiles WHERE user_id = $1`, [I1]);
  check('profile update still saves normal fields', ip.bio === 'new bio', r.err?.message || '');
  check('cannot self-verify or fake stats', ip.verified === false && ip.followers === 0 && Number(ip.engagement_rate) === 0 && ip.avg_views === 0, JSON.stringify(ip));

  r = await call(profiles.updateMyProfile, { user: { id: B, role: 'brand' }, body: { bio: 'b', verified: true } });
  const { rows: [bp] } = await pg.query(`SELECT verified, bio FROM brand_profiles WHERE user_id = $1`, [B]);
  check('brand cannot self-verify', bp.verified === false && bp.bio === 'b', r.err?.message || '');

  // ── Swipes ───────────────────────────────────────────────────
  const swipes = require(`${BACKEND}/src/controllers/swipeController`);
  r = await call(swipes.recordSwipe, { user: { id: I1, role: 'influencer' }, body: { swiped_id: B, direction: 'like' } });
  check('first like records, no match', r.status === 201 && r.body.matched === false, r.err?.message || '');
  r = await call(swipes.recordSwipe, { user: { id: B, role: 'brand' }, body: { swiped_id: I1, direction: 'like' } });
  check('reciprocal like creates a match (lock SQL runs)', r.status === 201 && r.body.matched === true, r.err?.message || '');
  await pg.exec(`INSERT INTO users (id, email) VALUES ('norole', 'n@x.com')`);
  r = await call(swipes.recordSwipe, { user: { id: B, role: 'brand' }, body: { swiped_id: 'norole', direction: 'like' } });
  check('cannot swipe a user without a role', r.status === 400);

  // ── Posts & likes ────────────────────────────────────────────
  const posts = require(`${BACKEND}/src/controllers/postController`);
  const own = `https://proj.supabase.co/storage/v1/object/public/public/uploads/${I1}/a.jpg`;
  r = await call(posts.createPost, { user: { id: I1 }, body: { image_url: 'https://evil.example/x.jpg' } });
  check('post with external image is rejected', r.status === 400);
  r = await call(posts.createPost, { user: { id: I1 }, body: { image_url: `https://proj.supabase.co/storage/v1/object/public/public/uploads/${I2}/a.jpg` } });
  check("post with another user's upload is rejected", r.status === 400);
  r = await call(posts.createPost, { user: { id: I1 }, body: { image_url: `https://proj.supabase.co/storage/v1/object/public/public/uploads/${I1}/../${I2}/a.jpg` } });
  check('path traversal out of own folder is rejected', r.status === 400);
  r = await call(posts.createPost, { user: { id: I1 }, body: { image_url: own, caption: 'hi' } });
  check('post with own upload is created', r.status === 201, r.err?.message || '');
  const postId = r.body.post.id;

  const like = (user, body) => call(posts.toggleLike, { user: { id: user }, params: { postId }, body });
  await like(B, { liked: true });
  await like(B, { liked: true });            // retry must not double count
  await like(I2, {});                         // legacy toggle → like
  let { rows: [pc] } = await pg.query('SELECT likes_count, (SELECT count(*) FROM post_likes WHERE post_id = $1)::int AS n FROM posts WHERE id = $1', [postId]);
  check('retried like does not double count', pc.likes_count === 2 && pc.n === 2, JSON.stringify(pc));
  await like(B, { liked: false });
  await like(B, { liked: false });           // retried unlike
  await like(I2, {});                         // legacy toggle → unlike
  ({ rows: [pc] } = await pg.query('SELECT likes_count, (SELECT count(*) FROM post_likes WHERE post_id = $1)::int AS n FROM posts WHERE id = $1', [postId]));
  check('unlikes keep count equal to rows', pc.likes_count === 0 && pc.n === 0, JSON.stringify(pc));
  r = await call(posts.toggleLike, { user: { id: B }, params: { postId: '00000000-0000-0000-0000-000000000000' }, body: { liked: false } });
  check('unlike on missing post → 404', r.status === 404);

  r = await call(posts.getFeedPosts, { user: { id: B }, query: {} });
  check('post feed has no author emails', r.status === 200 && r.body.posts.length === 1 && !('email' in r.body.posts[0]), JSON.stringify(Object.keys(r.body?.posts?.[0] || {})));

  // ── Stories ──────────────────────────────────────────────────
  const stories = require(`${BACKEND}/src/controllers/storyController`);
  r = await call(stories.uploadStory, { user: { id: I1 }, body: { media_url: 'data:image/jpeg;base64,AAAA' } });
  check('base64 story is rejected', r.status === 400);
  r = await call(stories.uploadStory, { user: { id: I1 }, body: { media_url: own } });
  check('story with own upload is created', r.status === 200, r.err?.message || '');
  r = await call(stories.getFeedStories, { user: { id: B } });
  check('matched brand sees the story', r.status === 200 && r.body.some((g) => g.id === I1), r.err?.message || '');


  // ── Blocks, reports, account deletion ───────────────────────
  const safety = require(`${BACKEND}/src/controllers/safetyController`);
  const { isBlockedBetween } = require(`${BACKEND}/src/utils/blocks`);
  // I1 and B are matched (from the swipe section) and I1 has a post + story.
  r = await call(safety.blockUser, { user: { id: B }, body: { user_id: I1 } });
  check('block succeeds', r.status === 201, r.err?.message || '');
  r = await call(safety.blockUser, { user: { id: B }, body: { user_id: I1 } });
  check('blocking twice is idempotent', r.status === 201, r.err?.message || '');
  check('block is visible in both directions', await isBlockedBetween(B, I1) && await isBlockedBetween(I1, B));
  let { rows: [m] } = await pg.query(`SELECT status FROM matches WHERE brand_id = $1 AND influencer_id = $2`, [B, I1]);
  check('blocking archives the match', m.status === 'archived');
  // Remove the swipe that would hide B anyway, so only the block can hide it.
  await pg.exec(`DELETE FROM swipes WHERE swiper_id = '${I1}'`);
  r = await call(getFeed, { user: { id: I1, role: 'influencer' } });
  check('blocked brand is gone from the blocker\'s target feed', r.status === 200 && !r.body.data.some((x) => x.id === B), r.err?.message || '');
  r = await call(posts.getFeedPosts, { user: { id: B }, query: {} });
  check('blocked author\'s posts are hidden', r.status === 200 && r.body.posts.length === 0, r.err?.message || '');
  r = await call(stories.getFeedStories, { user: { id: B } });
  check('blocked user\'s stories are hidden', r.status === 200 && !r.body.some((g) => g.id === I1), r.err?.message || '');
  await pg.exec(`DELETE FROM swipes WHERE swiper_id = '${B}'`);
  r = await call(swipes.recordSwipe, { user: { id: B, role: 'brand' }, body: { swiped_id: I1, direction: 'like' } });
  check('cannot swipe a blocked user (looks like 404)', r.status === 404, JSON.stringify(r.body || r.err?.message));
  // Restore I1's like and drop the match, so only the block can hide it.
  await pg.exec(`INSERT INTO swipes (swiper_id, swiped_id, direction) VALUES ('${I1}', '${B}', 'like'); DELETE FROM matches WHERE brand_id = '${B}'`);
  r = await call(swipes.getLikesReceived, { user: { id: B }, query: {} });
  check('likes from a blocked user are hidden', r.status === 200 && !r.body.data.some((x) => x.user_id === I1), r.err?.message || '');
  r = await call(safety.blockUser, { user: { id: B }, body: { user_id: B } });
  check('cannot block yourself', r.status === 400);
  r = await call(safety.listBlocks, { user: { id: B } });
  check('block list shows the blocked user with name', r.body.data.length === 1 && r.body.data[0].name === 'Near', JSON.stringify(r.body));
  r = await call(safety.unblockUser, { user: { id: B }, params: { userId: I1 } });
  check('unblock succeeds', r.status === 200 && !(await isBlockedBetween(B, I1)));
  r = await call(swipes.getLikesReceived, { user: { id: B }, query: {} });
  check('control: after unblock the like shows again', r.body.data.some((x) => x.user_id === I1));
  await pg.exec(`DELETE FROM swipes WHERE swiper_id = '${I1}'`);
  r = await call(getFeed, { user: { id: I1, role: 'influencer' } });
  check('control: after unblock the brand is back in the feed', r.body.data.some((x) => x.id === B));

  r = await call(safety.createReport, { user: { id: B }, body: { target_type: 'post', target_id: postId, reason: 'spam', details: 'x' } });
  check('report is created', r.status === 201 && r.body.id, r.err?.message || '');
  const reportId = r.body.id;
  r = await call(safety.listReports, { user: { id: 'admin' }, query: {} });
  check('admin sees open report', r.status === 200 && r.body.data.some((x) => x.id === reportId), r.err?.message || '');
  r = await call(safety.reviewReport, { user: { id: 'admin' }, params: { reportId }, body: { status: 'actioned' } });
  const { rows: [rep] } = await pg.query(`SELECT status, reviewed_by FROM reports WHERE id = $1`, [reportId]);
  check('admin can action a report', r.status === 200 && rep.status === 'actioned' && rep.reviewed_by === 'admin');

  r = await call(safety.deleteAccount, { user: { id: B } });
  const { rows: [left] } = await pg.query(`
    SELECT (SELECT count(*) FROM users WHERE id = $1)::int AS u,
           (SELECT count(*) FROM brand_profiles WHERE user_id = $1)::int AS p,
           (SELECT count(*) FROM matches WHERE brand_id = $1)::int AS m,
           (SELECT count(*) FROM swipes WHERE swiper_id = $1 OR swiped_id = $1)::int AS s,
           (SELECT count(*) FROM post_likes WHERE user_id = $1)::int AS l,
           (SELECT count(*) FROM reports WHERE id = $2 AND reporter_id IS NULL)::int AS orphaned_report`, [B, reportId]);
  check('account deletion removes user and all their rows', r.status === 200 && left.u + left.p + left.m + left.s + left.l === 0, JSON.stringify(left) + (r.err?.message || ''));
  check('their reports survive with no reporter', left.orphaned_report === 1);
  check('account deletion removes their files, auth user, and sockets',
    removed.includes(`uploads/${B}`) && deletedAuthUsers.includes(B) && disconnected.includes(`user_${B}`),
    JSON.stringify({ removed, deletedAuthUsers, disconnected }));
  r = await call(safety.deleteAccount, { user: { id: B } });
  check('retrying account deletion is safe', r.status === 200, r.err?.message || '');

  // ── Onboarding upsert (still an open production question) ─────
  const auth = require(`${BACKEND}/src/controllers/authController`);
  r = await call(auth.updateOnboardingData, { user: { id: 'new-user', email: 'n@y.com' }, body: { currentStep: 'name_input', role: 'Influencer' } });
  const { rows: [nu] } = await pg.query(`SELECT role, onboarding_data FROM users WHERE id = 'new-user'`);
  check('onboarding PUT creates a role-less row', r.status === 200 && nu && nu.role === null && nu.onboarding_data.currentStep === 'name_input', r.err?.message || '');
  r = await call(auth.syncUser, { user: { id: 'new-user', email: 'n@y.com' }, body: { role: 'influencer' } });
  const { rows: [nu2] } = await pg.query(`SELECT u.role, (SELECT count(*) FROM influencer_profiles WHERE user_id = 'new-user')::int AS p FROM users u WHERE id = 'new-user'`);
  check('sync after onboarding sets role and creates profile', r.status === 200 && nu2.role === 'influencer' && nu2.p === 1, r.err?.message || JSON.stringify(nu2));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
}

main()
  .then(() => process.exit(failures ? 1 : 0))
  .catch((e) => { console.error(e); process.exit(1); });
