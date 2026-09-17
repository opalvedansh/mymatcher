// Runs the real backend/migrate.js as a child process against a PGlite
// server over the Postgres wire protocol, covering the three DB states it
// can meet on deploy.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { postgis } from '@electric-sql/pglite-postgis';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BACKEND = fileURLToPath(new URL('../..', import.meta.url));
let failures = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

async function withServer(port, setup, fn) {
  const db = await PGlite.create({ extensions: { postgis, pg_trgm, uuid_ossp, pgcrypto } });
  if (setup) await setup(db);
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();
  try {
    await fn(db);
  } finally {
    await server.stop();
    await db.close();
  }
}

// Must be async: the DB server lives in this process, so a synchronous child
// call would block it from ever answering.
async function runMigrate(port) {
  try {
    const { stdout: out } = await execFileAsync('node', ['migrate.js'], {
      timeout: 120000,
      cwd: BACKEND,
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres` },
    });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: (err.stdout || '') + (err.stderr || '') };
  }
}

const tableExists = async (db, name) =>
  (await db.query(`SELECT to_regclass($1) IS NOT NULL AS e`, [`public.${name}`])).rows[0].e;
const applied = async (db) =>
  (await db.query(`SELECT filename FROM _migrations ORDER BY filename`)).rows.map((r) => r.filename);

const allFiles = fs.readdirSync(`${BACKEND}/migrations`).filter((f) => f.endsWith('.sql')).sort();

// 1. Fresh database: everything runs.
await withServer(55431, null, async (db) => {
  const r = await runMigrate(55431);
  check('fresh DB: migrate exits 0', r.ok, r.ok ? '' : r.out.slice(-400));
  check('fresh DB: all migrations recorded', JSON.stringify(await applied(db)) === JSON.stringify(allFiles));
  check('fresh DB: trust & safety tables exist', await tableExists(db, 'user_blocks') && await tableExists(db, 'reports'));
  const again = await runMigrate(55431);
  check('second run is a no-op', again.ok && /already up to date/.test(again.out), again.out.slice(-200));
});

// 2. Legacy DB (schema applied by the old script, no tracking table) with
//    real data: 001–020 must be seeded, 021 must actually run, data kept.
await withServer(55432, async (db) => {
  await db.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
  for (const f of allFiles.filter((f) => f <= '020_posts.sql')) {
    await db.exec(fs.readFileSync(`${BACKEND}/migrations/${f}`, 'utf8'));
  }
  await db.exec(`INSERT INTO users (id, email, role) VALUES ('keep-me', 'k@x.com', 'brand')`);
}, async (db) => {
  const r = await runMigrate(55432);
  check('legacy DB: migrate exits 0', r.ok, r.ok ? '' : r.out.slice(-400));
  check('legacy DB: 021 actually ran (was silently skipped before the fix)', await tableExists(db, 'user_blocks'));
  check('legacy DB: existing users kept (002 did not re-run)',
    (await db.query(`SELECT count(*)::int AS n FROM users WHERE id = 'keep-me'`)).rows[0].n === 1);
  check('legacy DB: tracking now lists every file', JSON.stringify(await applied(db)) === JSON.stringify(allFiles));
});

// 3. Tracked DB that is one migration behind (the normal production case).
await withServer(55433, async (db) => {
  await db.exec('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
  await db.exec(`CREATE TABLE _migrations (id SERIAL PRIMARY KEY, filename VARCHAR(255) UNIQUE NOT NULL, applied_at TIMESTAMPTZ DEFAULT NOW())`);
  for (const f of allFiles.filter((f) => f <= '020_posts.sql')) {
    await db.exec(fs.readFileSync(`${BACKEND}/migrations/${f}`, 'utf8'));
    await db.query(`INSERT INTO _migrations (filename) VALUES ($1)`, [f]);
  }
  await db.exec(`INSERT INTO users (id, email, role) VALUES ('keep-me', 'k@x.com', 'brand')`);
}, async (db) => {
  const r = await runMigrate(55433);
  check('tracked DB: migrate exits 0 and applies only 021', r.ok && /Running migration: 021_trust_safety.sql/.test(r.out) && !/Running migration: 0[0-1]/.test(r.out), r.out.slice(-300));
  check('tracked DB: data kept', (await db.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n === 1);
});

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
