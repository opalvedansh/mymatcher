// Verifies migration 029 and the ranked feed against a real Postgres (PGlite),
// the same way tests/integration/migrate.mjs does. Never touches prod.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { postgis } from '@electric-sql/pglite-postgis';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const BACKEND = fileURLToPath(new URL('../..', import.meta.url));
const PORT = 55499;

let failures = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
};

async function expectError(label, fn, codeOrText) {
  try {
    await fn();
    check(label, false, 'expected an error, got success');
  } catch (err) {
    const msg = `${err.code || ''} ${err.message || ''}`;
    check(label, msg.includes(codeOrText), msg.trim().slice(0, 120));
  }
}

const db = await PGlite.create({ extensions: { postgis, pg_trgm, uuid_ossp, pgcrypto } });
const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
await server.start();
const DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;

try {
  // ── Run the real migration runner ──────────────────────────────────
  const { stdout } = await execFileAsync('node', ['migrate.js'], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL, NODE_ENV: 'test' },
  });
  check('all migrations apply cleanly', /029_post_engagement/.test(stdout), '029 applied');

  // ── Seed ───────────────────────────────────────────────────────────
  await db.exec(`
    INSERT INTO users (id, email, role, banned) VALUES
      ('viewer', 'v@t.co', 'brand', false),
      ('fashion1', 'f1@t.co', 'influencer', false),
      ('fashion2', 'f2@t.co', 'influencer', false),
      ('fitness1', 'g1@t.co', 'influencer', false),
      ('blocked1', 'b1@t.co', 'influencer', false),
      ('doomed1',  'd1@t.co', 'influencer', false);

    INSERT INTO influencer_profiles (user_id, name, categories) VALUES
      ('fashion1', 'Aanya',  ARRAY['Fashion','Beauty']),
      ('fashion2', 'Kabir',  ARRAY['Fashion']),
      ('fitness1', 'Rex',    ARRAY['Fitness']),
      ('blocked1', 'Troll',  ARRAY['Fashion']);
    INSERT INTO brand_profiles (user_id, name, categories) VALUES
      ('viewer', 'BrandCo', ARRAY['Fashion']);
  `);

  const mkPost = async (id, user, hoursAgo) => {
    await db.query(
      `INSERT INTO posts (id, user_id, image_url, caption, created_at)
       VALUES ($1, $2, 'https://cdn.test/i.jpg', 'x', now() - ($3 || ' hours')::interval)`,
      [id, user, String(hoursAgo)]
    );
  };
  const P = (n) => `00000000-0000-4000-8000-00000000000${n}`;
  await mkPost(P(1), 'fashion1', 2);
  await mkPost(P(2), 'fashion2', 3);
  await mkPost(P(3), 'fitness1', 1); // newest, but off-interest
  await mkPost(P(4), 'blocked1', 1);

  // ── Notification types ─────────────────────────────────────────────
  // 029 rebuilds this constraint, so it has to carry every type earlier
  // migrations added, not just the ones 025 declared.
  for (const type of ['new_match', 'new_like', 'announcement', 'post_like', 'post_comment', 'comment_reply']) {
    try {
      await db.query(
        `INSERT INTO notifications (user_id, type, title) VALUES ('viewer', $1, 't')`,
        [type]
      );
      check(`notification type '${type}' is allowed`, true);
    } catch (err) {
      check(`notification type '${type}' is allowed`, false, err.message.slice(0, 90));
    }
  }
  await db.query(`DELETE FROM notifications WHERE user_id = 'viewer'`);

  // ── Comment triggers ───────────────────────────────────────────────
  const { rows: [c1] } = await db.query(
    `INSERT INTO post_comments (post_id, user_id, body) VALUES ($1, 'viewer', 'top level') RETURNING id`,
    [P(1)]
  );
  const { rows: [r1] } = await db.query(
    `INSERT INTO post_comments (post_id, user_id, parent_id, body) VALUES ($1, 'fashion2', $2, 'a reply') RETURNING id`,
    [P(1), c1.id]
  );

  let { rows } = await db.query(`SELECT comments_count FROM posts WHERE id = $1`, [P(1)]);
  check('posts.comments_count counts comment + reply', rows[0].comments_count === 2, `got ${rows[0].comments_count}`);

  ({ rows } = await db.query(`SELECT replies_count FROM post_comments WHERE id = $1`, [c1.id]));
  check('parent.replies_count = 1', rows[0].replies_count === 1, `got ${rows[0].replies_count}`);

  await expectError('reply to a reply is rejected (one level)', () =>
    db.query(`INSERT INTO post_comments (post_id, user_id, parent_id, body) VALUES ($1,'viewer',$2,'nested')`, [P(1), r1.id]),
    'one level'
  );

  await expectError('parent from another post is rejected', () =>
    db.query(`INSERT INTO post_comments (post_id, user_id, parent_id, body) VALUES ($1,'viewer',$2,'cross')`, [P(2), c1.id]),
    'different post'
  );

  await expectError('empty comment body is rejected', () =>
    db.query(`INSERT INTO post_comments (post_id, user_id, body) VALUES ($1,'viewer','   ')`, [P(1)]),
    '23514'
  );

  // Deleting the parent cascades the reply and decrements the post counter.
  await db.query(`DELETE FROM post_comments WHERE id = $1`, [c1.id]);
  ({ rows } = await db.query(`SELECT comments_count FROM posts WHERE id = $1`, [P(1)]));
  check('deleting a parent cascades its reply into the count', rows[0].comments_count === 0, `got ${rows[0].comments_count}`);

  // ── Like counter survives a cascade (the bug 029 fixes) ────────────
  await db.query(`INSERT INTO post_likes (post_id, user_id) VALUES ($1,'fashion2'),($1,'doomed1')`, [P(1)]);
  ({ rows } = await db.query(`SELECT likes_count FROM posts WHERE id = $1`, [P(1)]));
  check('likes_count tracks inserts', rows[0].likes_count === 2, `got ${rows[0].likes_count}`);

  await db.query(`DELETE FROM users WHERE id = 'doomed1'`);
  ({ rows } = await db.query(`SELECT likes_count FROM posts WHERE id = $1`, [P(1)]));
  check('likes_count stays correct after an account deletion', rows[0].likes_count === 1, `got ${rows[0].likes_count}`);

  // ── Comment likes + shares ─────────────────────────────────────────
  const { rows: [c2] } = await db.query(
    `INSERT INTO post_comments (post_id, user_id, body) VALUES ($1,'fashion1','nice') RETURNING id`, [P(2)]
  );
  await db.query(`INSERT INTO comment_likes (comment_id, user_id) VALUES ($1,'viewer')`, [c2.id]);
  ({ rows } = await db.query(`SELECT likes_count FROM post_comments WHERE id = $1`, [c2.id]));
  check('comment likes_count trigger works', rows[0].likes_count === 1, `got ${rows[0].likes_count}`);

  await db.query(`INSERT INTO post_shares (post_id, user_id, channel) VALUES ($1,'viewer','app')`, [P(2)]);
  ({ rows } = await db.query(`SELECT shares_count FROM posts WHERE id = $1`, [P(2)]));
  check('shares_count trigger works', rows[0].shares_count === 1, `got ${rows[0].shares_count}`);

  await db.query(`DELETE FROM users WHERE id = 'viewer'`);
  ({ rows } = await db.query(`SELECT p.shares_count, s.user_id FROM posts p JOIN post_shares s ON s.post_id = p.id WHERE p.id = $1`, [P(2)]));
  check('a share outlives its sharer (ON DELETE SET NULL)', rows.length === 1 && rows[0].user_id === null,
    JSON.stringify(rows[0] ?? null));

  // ── Ranked feed through the real service ───────────────────────────
  // Re-seed the viewer that the cascade test just deleted.
  await db.exec(`
    INSERT INTO users (id, email, role, banned) VALUES ('viewer', 'v2@t.co', 'brand', false);
    INSERT INTO brand_profiles (user_id, name, categories) VALUES ('viewer', 'BrandCo', ARRAY['Fashion']);
    INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('viewer', 'blocked1');
  `);
  // Viewer engages with Fashion only.
  await db.query(`INSERT INTO post_likes (post_id, user_id) VALUES ($1,'viewer')`, [P(2)]);
  await db.query(`INSERT INTO post_comments (post_id, user_id, body) VALUES ($1,'viewer','love this')`, [P(2)]);

  process.env.DATABASE_URL = DATABASE_URL;
  const { createRequire } = await import('node:module');
  const require = createRequire(`${BACKEND}/package.json`);
  const postRanking = require('./src/services/postRanking.js');

  const page = await postRanking.getPage('viewer', null, 10);
  const ids = page.posts.map((p) => p.id);

  check('ranked feed returns posts', ids.length > 0, `${ids.length} posts`);
  check('blocked author is excluded', !ids.includes(P(4)), ids.join(','));
  check('engaged-with category outranks a newer off-interest post',
    ids.indexOf(P(2)) < ids.indexOf(P(3)),
    `fashion@${ids.indexOf(P(2))} vs fitness@${ids.indexOf(P(3))}`);
  check('feed exposes the new counters',
    page.posts[0].comments_count !== undefined && page.posts[0].shares_count !== undefined,
    Object.keys(page.posts[0]).join(','));

  // Pagination: a 1-per-page walk must not repeat or drop anything.
  const seen = [];
  let cursor = null;
  for (let i = 0; i < 10; i++) {
    const p = await postRanking.getPage('viewer', cursor, 1);
    seen.push(...p.posts.map((x) => x.id));
    cursor = p.next_cursor;
    if (!cursor) break;
  }
  check('paginating one at a time yields no duplicates',
    new Set(seen).size === seen.length, seen.join(','));
  check('paginating covers the same set as one big page',
    new Set(seen).size === new Set(ids).size, `${seen.length} vs ${ids.length}`);

  const cold = await postRanking.getPage('fashion1', null, 10);
  check('a user with no engagement history still gets a feed', cold.posts.length > 0, `${cold.posts.length} posts`);
} finally {
  await server.stop();
  await db.close();
}

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
