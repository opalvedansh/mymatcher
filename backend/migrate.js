require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// The last migration that existed before this runner tracked what it applied.
const LEGACY_BASELINE = '020_posts.sql';

const DESTRUCTIVE_MIGRATIONS = new Set(['002_firebase_uid.sql']);

async function runMigrations() {
  console.log(`Connecting to database...`);
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    
    // Check if _migrations table already exists
    const checkTable = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = '_migrations'
      );
    `);
    
    const trackingExists = checkTable.rows[0].exists;

    if (!trackingExists) {
      console.log('Creating _migrations tracking table...');
      await client.query(`
        CREATE TABLE _migrations (
          id SERIAL PRIMARY KEY,
          filename VARCHAR(255) UNIQUE NOT NULL,
          applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // If the 'users' table already exists, the database was previously migrated
      // using the old script. We need to seed the tracking table so we don't re-run
      // drop/create scripts and wipe data.
      const checkUsers = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = 'users'
        );
      `);

      if (checkUsers.rows[0].exists) {
        console.log('Existing database detected. Seeding tracking table to prevent data loss...');
        const migrationsDir = path.join(__dirname, 'migrations');
        // Only migrations that predate tracking were applied by the old script.
        // Seeding anything newer would mark it applied without ever running it.
        const files = fs.readdirSync(migrationsDir)
          .filter(f => f.endsWith('.sql') && f <= LEGACY_BASELINE)
          .sort();

        for (const file of files) {
          await client.query('INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
        }
        console.log('✅ Seeded tracking table with previous migrations.');
      }
    }

    // Get list of already applied migrations
    const { rows } = await client.query('SELECT filename FROM _migrations');
    const appliedMigrations = new Set(rows.map(row => row.filename));

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Sorts 001, 002, 003, etc.

    let appliedCount = 0;

    for (const file of files) {
      if (appliedMigrations.has(file)) {
        continue; // Skip already applied migrations
      }

      // 002 drops and recreates the core tables. Migrations run on every
      // deploy, so refuse it outright if there is any user data to lose.
      if (DESTRUCTIVE_MIGRATIONS.has(file)) {
        const { rows: [{ has_table }] } = await client.query(
          `SELECT to_regclass('public.users') IS NOT NULL AS has_table`
        );
        if (has_table) {
          const { rows: [{ has_users }] } = await client.query(
            'SELECT EXISTS (SELECT 1 FROM users) AS has_users'
          );
          if (has_users) {
            throw new Error(`Refusing to run destructive migration ${file}: the users table contains data.`);
          }
        }
      }

      console.log(`Running migration: ${file}`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`✅ ${file} applied successfully.`);
        appliedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    if (appliedCount === 0) {
      console.log('👍 Database is already up to date. No new migrations to apply.');
    } else {
      console.log(`🎉 ${appliedCount} new migrations applied successfully!`);
    }
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
