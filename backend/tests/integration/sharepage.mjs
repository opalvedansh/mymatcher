// Boots the real express app against PGlite and exercises the public share page.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { postgis } from '@electric-sql/pglite-postgis';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const BACKEND = fileURLToPath(new URL('../..', import.meta.url));
const PORT = 55501;

let failures = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
};

const db = await PGlite.create({ extensions: { postgis, pg_trgm, uuid_ossp, pgcrypto } });
const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
await server.start();
const DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;

let httpServer;
try {
  await execFileAsync('node', ['migrate.js'], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL, NODE_ENV: 'test' },
  });

  const POST_ID = '00000000-0000-4000-8000-0000000000aa';
  const XSS = `</title><script>alert('x')</script>" onerror="alert(1)`;
  await db.exec(`
    INSERT INTO users (id, email, role, banned) VALUES ('creator','c@t.co','influencer',false);
    INSERT INTO influencer_profiles (user_id, name) VALUES ('creator','Aanya Raghavan');
  `);
  await db.query(
    `INSERT INTO posts (id, user_id, image_url, caption) VALUES ($1,'creator','https://cdn.test/i.jpg',$2)`,
    [POST_ID, XSS]
  );

  process.env.DATABASE_URL = DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.IOS_APP_ID_PREFIX = 'ABCDE12345';
  process.env.IOS_APP_STORE_URL = 'https://apps.apple.com/app/id123';
  const require = createRequire(`${BACKEND}/package.json`);
  const app = require('./src/app.js');

  await new Promise((resolve) => { httpServer = app.listen(0, resolve); });
  const base = `http://127.0.0.1:${httpServer.address().port}`;

  // ── The page itself ────────────────────────────────────────────────
  const iosUA = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' };
  const res = await fetch(`${base}/p/${POST_ID}`, { headers: iosUA });
  const html = await res.text();

  check('share page is public (no auth)', res.status === 200, `status ${res.status}`);
  check('serves HTML', (res.headers.get('content-type') || '').includes('text/html'));
  check('carries OpenGraph image', html.includes('property="og:image"'));
  check('carries the author name', html.includes('Aanya Raghavan'));
  check('is marked noindex', res.headers.get('x-robots-tag') === 'noindex');

  check('escapes the caption (no live script tag)', !html.includes("<script>alert('x')</script>"));
  check('escapes quotes in attributes', !html.includes('onerror="alert(1)"'));
  check('caption survives as escaped text', html.includes('&lt;script&gt;'));

  check('uses the brand accent, not an invented one',
    html.includes('#ff6b2b') && !html.includes('#ff3b6b'));
  check('iPhone is offered the App Store only',
    html.includes('Get Matchr for iPhone') && !html.includes('Get Matchr for Android'));

  const androidRes = await fetch(`${base}/p/${POST_ID}`, {
    headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' },
  });
  const androidHtml = await androidRes.text();
  check('Android is offered Play only',
    androidHtml.includes('Get Matchr for Android') && !androidHtml.includes('Get Matchr for iPhone'));

  // ── Missing and malformed ──────────────────────────────────────────
  const missing = await fetch(`${base}/p/00000000-0000-4000-8000-0000000000ff`);
  check('unknown post returns a 404 page', missing.status === 404, `status ${missing.status}`);
  const malformed = await fetch(`${base}/p/not-a-uuid`);
  check('malformed id returns 404, not a 500', malformed.status === 404, `status ${malformed.status}`);

  // ── Association files ──────────────────────────────────────────────
  const aasa = await fetch(`${base}/.well-known/apple-app-site-association`);
  const aasaBody = await aasa.json();
  check('AASA served as JSON', (aasa.headers.get('content-type') || '').includes('application/json'));
  check('AASA claims the /p/* path',
    aasaBody.applinks.details[0].components[0]['/'] === '/p/*',
    JSON.stringify(aasaBody.applinks.details[0]));
  check('AASA appID uses the team prefix',
    aasaBody.applinks.details[0].appIDs[0].startsWith('ABCDE12345.'));

  delete process.env.ANDROID_CERT_SHA256;
  const links = await fetch(`${base}/.well-known/assetlinks.json`);
  check('assetlinks 404s when no fingerprint is configured', links.status === 404, `status ${links.status}`);

  // ── Blocked author still visible publicly? ─────────────────────────
  await db.query(`UPDATE users SET banned = true WHERE id = 'creator'`);
  const banned = await fetch(`${base}/p/${POST_ID}`);
  check('a banned author\'s post stops resolving', banned.status === 404, `status ${banned.status}`);
} finally {
  if (httpServer) await new Promise((r) => httpServer.close(r));
  await server.stop();
  await db.close();
}

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
