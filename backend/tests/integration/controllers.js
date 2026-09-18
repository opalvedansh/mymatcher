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
// Stands in for the Socket.io server and records what the backend asks of it.
const disconnected = [];
const roomEvents = [];
const fakeIo = {
  to: (room) => ({ emit: (event, payload) => roomEvents.push({ room, event, payload }) }),
  in: (room) => ({
    disconnectSockets: () => disconnected.push(room),
    socketsLeave: (left) => roomEvents.push({ room, event: 'leave', payload: left }),
  }),
};

let failures = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

/** A no-op stand-in for what middleware/adminAudit attaches to every request. */
const auditStub = () => ({
  meta: {}, force: false, suppressed: false, rowId: null,
  set() { return this; }, add() { return this; }, snapshot() { return this; }, skip() { return this; },
});

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
      setHeader() {}, set() { return this; }, write() {}, end() { resolve({ status: this.statusCode }); },
    };
    handler(
      {
        query: {},
        params: {},
        body: {},
        headers: {},
        // requireAdmin and adminAudit normally supply these.
        admin: { id: 'admin', email: 'admin@matchr.in', role: 'superadmin', permissions: ['*'] },
        audit: auditStub(),
        ...req,
      },
      res,
      (err) => resolve({ status: 'next', err })
    );
  });
}

async function main() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { postgis } = await import('@electric-sql/pglite-postgis');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { uuid_ossp } = await import('@electric-sql/pglite/contrib/uuid_ossp');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  require(`${BACKEND}/src/realtime`).setServer(fakeIo);
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
  require(`${BACKEND}/src/utils/sharedCache`)._local.flush();
  r = await call(getFeed, { user: { id: B, role: 'brand' } });
  check('decimal / junk admin weights no longer break the feed', r.status === 200, r.err?.message || '');

  r = await call(getFeed, { user: { id: I1, role: 'influencer' } });
  check('influencer feed returns 200 with brands', r.status === 200 && r.body.data[0]?.id === B, r.err?.message || '');
  check('brand feed rows carry the fields the swipe card shows',
    'rating_avg' in (r.body.data[0] || {}) && 'rating_count' in r.body.data[0] && 'deliverable_reels' in r.body.data[0],
    JSON.stringify(Object.keys(r.body.data[0] || {})));

  await pg.exec(`UPDATE influencer_profiles SET worked_with = '{Nykaa,Boat}' WHERE user_id = '${I1}'`);
  r = await call(getFeed, { user: { id: B, role: 'brand' } });
  check('creator feed rows carry the brands the creator listed',
    JSON.stringify(r.body.data[0]?.worked_with) === '["Nykaa","Boat"]', JSON.stringify(r.body.data[0]?.worked_with));

  // Numbers written straight into the table, with no Instagram sync behind them.
  await pg.exec(`UPDATE influencer_profiles SET followers = 40000, avg_views = 42000 WHERE user_id = '${I1}'`);
  r = await call(getFeed, { user: { id: B, role: 'brand' } });
  check('hand-entered audience figures are marked unverified',
    r.body.data[0]?.stats_verified === false, JSON.stringify({ f: r.body.data[0]?.followers, v: r.body.data[0]?.stats_verified }));

  await pg.exec(`UPDATE influencer_profiles SET instagram_synced_at = NOW() WHERE user_id = '${I1}'`);
  r = await call(getFeed, { user: { id: B, role: 'brand' } });
  check('figures from a sync are marked verified', r.body.data[0]?.stats_verified === true, JSON.stringify(r.body.data[0]?.stats_verified));
  await pg.exec(`UPDATE influencer_profiles SET followers = 0, avg_views = 0, instagram_synced_at = NULL WHERE user_id = '${I1}'`);

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

  // ── Reply speed (measured from real messages) ────────────────
  const B2 = 'brand-2';
  await pg.exec(`
    INSERT INTO users (id, email, role) VALUES
      ('${B2}', 'b2@x.com', 'brand'),
      ('infl-a', 'a@x.com', 'influencer'), ('infl-b', 'b@x.com', 'influencer'),
      ('infl-c', 'c@x.com', 'influencer'), ('infl-d', 'd@x.com', 'influencer');
    INSERT INTO brand_profiles (user_id, name) VALUES ('${B2}', 'Brand Two');
    INSERT INTO influencer_profiles (user_id, name) VALUES
      ('infl-a', 'A'), ('infl-b', 'B'), ('infl-c', 'C'), ('infl-d', 'D');
    INSERT INTO matches (id, brand_id, influencer_id) VALUES
      ('11111111-1111-1111-1111-111111111111', '${B2}', 'infl-a'),
      ('22222222-2222-2222-2222-222222222222', '${B2}', 'infl-b'),
      ('33333333-3333-3333-3333-333333333333', '${B2}', 'infl-c'),
      ('44444444-4444-4444-4444-444444444444', '${B2}', 'infl-d');
    INSERT INTO messages (match_id, sender_id, content, created_at) VALUES
      -- answered in 30 minutes
      ('11111111-1111-1111-1111-111111111111', 'infl-a', 'hi',    now() - interval '5 hours'),
      ('11111111-1111-1111-1111-111111111111', '${B2}',  'hello', now() - interval '4 hours 30 minutes'),
      -- answered in 90 minutes
      ('22222222-2222-2222-2222-222222222222', 'infl-b', 'hi',    now() - interval '5 hours'),
      ('22222222-2222-2222-2222-222222222222', '${B2}',  'hello', now() - interval '3 hours 30 minutes'),
      -- the brand spoke first and never answered what came back
      ('33333333-3333-3333-3333-333333333333', '${B2}',  'pitch', now() - interval '6 hours'),
      ('33333333-3333-3333-3333-333333333333', 'infl-c', 'hi',    now() - interval '5 hours'),
      -- nobody answered the brand: not a conversation the creator started
      ('44444444-4444-4444-4444-444444444444', '${B2}',  'pitch', now() - interval '6 hours');
  `);

  r = await call(profiles.getMyResponsiveness, { user: { id: B2, role: 'brand' } });
  check('reply speed counts only conversations creators started',
    r.body?.conversations === 3, JSON.stringify(r.body) + (r.err?.message || ''));
  check('reply speed counts an unanswered conversation against the rate',
    r.body?.replied === 2 && r.body?.response_rate === 67, JSON.stringify(r.body));
  check('reply speed takes the median delay, ignoring messages sent before the creator wrote',
    r.body?.median_reply_seconds === 3600, JSON.stringify(r.body));

  r = await call(profiles.getMyResponsiveness, { user: { id: 'infl-a', role: 'influencer' } });
  check('reply speed withholds figures below the sample size',
    r.body?.conversations === 1 && r.body?.response_rate === null && r.body?.median_reply_seconds === null,
    JSON.stringify(r.body) + (r.err?.message || ''));

  // ── Brand deliverables (migration 026) ───────────────────────
  r = await call(profiles.updateMyProfile, {
    user: { id: B2, role: 'brand' },
    body: { deliverable_reels: 1, deliverable_stories: 2, deliverable_posts: 0 },
  });
  check('a brand can save the deliverables it asks for',
    r.status === 200 && r.body?.deliverable_reels === 1 && r.body?.deliverable_stories === 2 && r.body?.deliverable_posts === 0,
    JSON.stringify(r.body) + (r.err?.message || ''));
  let dbErr = null;
  await pg.query(`UPDATE brand_profiles SET deliverable_reels = 500 WHERE user_id = $1`, [B2]).catch((e) => { dbErr = e; });
  check('the database refuses an absurd deliverable count', dbErr !== null);

  // ── Ratings, payment terms and verification ──────────────────
  const ratings = require(`${BACKEND}/src/controllers/ratingController`);

  r = await call(ratings.rateBrand, {
    user: { id: 'infl-a', role: 'influencer' }, params: { brandId: B2 }, body: { score: 5 },
  });
  check('a matched creator can rate a brand', r.status === 200 && r.body?.average === 5, JSON.stringify(r.body) + (r.err?.message || ''));

  r = await call(ratings.rateBrand, {
    user: { id: 'infl-b', role: 'influencer' }, params: { brandId: B2 }, body: { score: 4 },
  });
  check('a second rating moves the average', r.body?.count === 2 && r.body?.average === 4.5, JSON.stringify(r.body));

  r = await call(ratings.rateBrand, {
    user: { id: 'infl-a', role: 'influencer' }, params: { brandId: B2 }, body: { score: 3 },
  });
  check('rating again replaces the first score rather than adding one',
    r.body?.count === 2 && r.body?.average === 3.5, JSON.stringify(r.body));

  r = await call(ratings.rateBrand, {
    user: { id: I2, role: 'influencer' }, params: { brandId: B2 }, body: { score: 5 },
  });
  check('a creator who never matched the brand cannot rate it', r.status === 403, JSON.stringify(r.body));

  r = await call(profiles.getMyProfile, { user: { id: B2, role: 'brand' } });
  check('the brand profile carries the real average and count',
    Number(r.body?.rating_avg) === 3.5 && r.body?.rating_count === 2, JSON.stringify({ a: r.body?.rating_avg, c: r.body?.rating_count }));

  r = await call(ratings.removeMyRating, { user: { id: 'infl-b', role: 'influencer' }, params: { brandId: B2 } });
  check('a creator can take their rating back', r.body?.removed === 1, JSON.stringify(r.body));

  r = await call(profiles.updateMyProfile, {
    user: { id: B2, role: 'brand' }, body: { payment_mode: 'upi', payment_days: 14 },
  });
  check('a brand can state its payment terms',
    r.body?.payment_mode === 'upi' && r.body?.payment_days === 14, JSON.stringify(r.body) + (r.err?.message || ''));
  r = await call(profiles.updateMyProfile, { user: { id: B2, role: 'brand' }, body: { payment_mode: '' } });
  check('an empty mode clears the terms rather than being ignored', r.body?.payment_mode === null, JSON.stringify(r.body));

  let termsErr = null;
  await pg.query(`UPDATE brand_profiles SET payment_mode = 'cash-in-hand' WHERE user_id = $1`, [B2]).catch((e) => { termsErr = e; });
  check('the database refuses a payment mode the profile cannot render', termsErr !== null);

  r = await call(profiles.requestVerification, {
    user: { id: B2, role: 'brand' }, body: { business_name: 'Brand Two Pvt Ltd', reg_number: '29ABCDE1234F1Z5' },
  });
  check('requesting verification queues it for review', r.body?.verification_status === 'pending', JSON.stringify(r.body) + (r.err?.message || ''));
  const { rows: [pendingBrand] } = await pg.query(`SELECT verified FROM brand_profiles WHERE user_id = $1`, [B2]);
  check('requesting verification does not grant the badge', pendingBrand.verified === false);

  r = await call(profiles.getProfileById, { user: { id: 'infl-a', role: 'influencer' }, params: { userId: B2 } });
  check('a visitor cannot see the review status or the registration number',
    !('verification_status' in r.body) && !('verification_reg_number' in r.body), JSON.stringify(Object.keys(r.body || {})));

  const admin = require(`${BACKEND}/src/controllers/adminController`);
  r = await call(admin.listVerifications, { user: { id: 'admin' }, query: {} });
  check('the pending request reaches the admin queue with its details',
    r.body?.data?.[0]?.user_id === B2 && r.body.data[0].verification_reg_number === '29ABCDE1234F1Z5', JSON.stringify(r.body));

  r = await call(admin.reviewVerification, { user: { id: 'admin' }, params: { userId: B2 }, body: { status: 'approved' } });
  check('an admin approval sets the badge', r.body?.verified === true && r.body?.verification_status === 'approved', JSON.stringify(r.body) + (r.err?.message || ''));

  // The old handler had `AND verification_status = 'pending'` in its WHERE, so
  // a mistaken approval could never be revoked. The audit log is the safety
  // net now, and taking a wrongly granted badge back is exactly the thing an
  // operator has to be able to do.
  r = await call(admin.reviewVerification, { user: { id: 'admin' }, params: { userId: B2 }, body: { status: 'rejected' } });
  check('a mistaken approval can be revoked',
    r.body?.verified === false && r.body?.verification_status === 'rejected', JSON.stringify(r.body));
  check('and the review records who did it', r.body?.verification_reviewed_by === 'admin', JSON.stringify(r.body));

  // ── The ban fix ───────────────────────────────────────────────
  // Before this, feedRanking filtered on role, self, prior swipes and blocks
  // but never on banned: a banned user kept being dealt into everyone else's
  // deck and their profile still resolved. endSessions only dropped their own
  // connections. This is the assertion a mocked-db test cannot make.
  const ranking = require(`${BACKEND}/src/services/feedRanking`);
  const profileCtl = require(`${BACKEND}/src/controllers/profileController`);

  const viewerCtx = await ranking.loadContext(B, 'brand');
  const before = await ranking.scoreCandidates(viewerCtx, { cursor: null, limit: 50 });
  const visibleBefore = before.some((row) => row.id === I1);
  check('an active creator is in the brand deck', visibleBefore, `saw ${before.length} candidates`);

  await pg.query(`UPDATE users SET banned = true, banned_at = now() WHERE id = $1`, [I1]);
  const after = await ranking.scoreCandidates(viewerCtx, { cursor: null, limit: 50 });
  check('banning removes them from the deck', !after.some((row) => row.id === I1),
    `still saw ${after.filter((row) => row.id === I1).length}`);

  r = await call(profileCtl.getProfileById, { user: { id: B }, params: { userId: I1 } });
  check('and their profile stops resolving', r.status === 404, JSON.stringify(r.body));

  await pg.query(`UPDATE users SET banned = false, banned_at = NULL WHERE id = $1`, [I1]);
  const restored = await ranking.scoreCandidates(viewerCtx, { cursor: null, limit: 50 });
  check('unbanning puts them back', restored.some((row) => row.id === I1));

  // Soft delete uses the same predicate, so it must hide them too.
  await pg.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [I1]);
  const deleted = await ranking.scoreCandidates(viewerCtx, { cursor: null, limit: 50 });
  check('a soft-deleted account is hidden as well', !deleted.some((row) => row.id === I1));
  await pg.query(`UPDATE users SET deleted_at = NULL WHERE id = $1`, [I1]);

  // ── Admin RBAC and audit (migration 028) ──────────────────────
  await pg.query(
    `INSERT INTO admin_users (user_id, email, role, created_by) VALUES ($1, $2, 'superadmin', 'test')`,
    ['admin', 'admin@matchr.in']
  );
  const { rows: [roleCheck] } = await pg.query(
    `SELECT count(*)::int AS n FROM admin_users WHERE user_id = 'admin' AND revoked_at IS NULL`
  );
  check('admin_users accepts a valid role', roleCheck.n === 1);

  let rejected = false;
  try {
    await pg.query(`INSERT INTO admin_users (user_id, role) VALUES ('x', 'root')`);
  } catch { rejected = true; }
  check('admin_users rejects a role outside the CHECK', rejected);

  const auditSvc = require(`${BACKEND}/src/services/adminAudit`);
  const written = await auditSvc.record({
    adminId: 'admin', action: 'user.ban', targetType: 'user', targetId: I1,
    reason: 'integration check', metadata: { before: { banned: false } },
    ip: auditSvc.clientIp({ ip: '::ffff:10.0.0.1' }),
  });
  check('the audit log accepts an IPv4-mapped address and returns its id', Number(written.id) > 0);

  const { rows: [auditRow] } = await pg.query(
    `SELECT host(ip) AS ip, metadata, status FROM admin_audit_log WHERE id = $1`, [written.id]
  );
  check('and stores it unwrapped, with metadata and a null status',
    auditRow.ip === '10.0.0.1' && auditRow.metadata.before.banned === false && auditRow.status === null,
    JSON.stringify(auditRow));

  // ── Broadcasts need the widened notifications CHECK ───────────
  let announceErr = '';
  const { rows: [liveUser] } = await pg.query(
    `SELECT id FROM users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`
  );
  try {
    await pg.query(
      `INSERT INTO notifications (user_id, type, title, body) VALUES ($1, 'announcement', 'Hi', 'There')`,
      [liveUser.id]
    );
  } catch (err) { announceErr = err.message; }
  check("notifications accepts type 'announcement' after 028", !announceErr, announceErr);

  // ── Metrics SQL, against real rows ────────────────────────────
  const metrics = require(`${BACKEND}/src/services/adminMetrics`);
  const stats = await metrics.getStats();
  check('stats are exact and never negative',
    Number.isInteger(stats.total_users) && Object.values(stats).every((v) => v >= 0), JSON.stringify(stats));

  // A signup at 23:30 UTC belongs to the NEXT day in Asia/Kolkata (+05:30).
  // Bucketing on created_at::date would put it on the previous one and make
  // every chart look like it dips overnight.
  await pg.query(`INSERT INTO users (id, email, role, created_at) VALUES ('tz-user', 'tz@x.com', 'brand', '2026-03-10T23:30:00Z')`);
  const ts = await metrics.getTimeseries({ from: '2026-03-10', to: '2026-03-12', tz: 'Asia/Kolkata' });
  const day10 = ts.series.find((d) => d.day === '2026-03-10');
  const day11 = ts.series.find((d) => d.day === '2026-03-11');
  check('the time series gap-fills every day in range', ts.series.length === 3, JSON.stringify(ts.series.map((d) => d.day)));
  check('and buckets a 23:30 UTC signup into the next IST day',
    day10.signups === 0 && day11.signups === 1, JSON.stringify({ day10, day11 }));

  const funnel = await metrics.getFunnel({ from: '2020-01-01', to: '2030-01-01' });
  const counts = funnel.stages.map((s) => s.count);
  // Nested by construction, so this can only fail if a stage stops repeating
  // the conditions of the one before it.
  check('the funnel never increases from one stage to the next',
    counts.every((n, i) => i === 0 || n <= counts[i - 1]),
    JSON.stringify(funnel.stages.map((s) => [s.key, s.count])));
  check('profile completeness is reported beside the funnel, not inside it',
    typeof funnel.profile_complete?.count === 'number'
      && !funnel.stages.some((s) => s.key === 'profile_complete'),
    JSON.stringify(funnel.profile_complete));

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
