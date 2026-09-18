const db = require('../config/db');
const sharedCache = require('../utils/sharedCache');

/** 422 with the message passed through: errorHandler exposes sub-500 messages. */
function badValue(message) {
  const err = new Error(message);
  err.statusCode = 422;
  err.expose = true;
  return err;
}

const WEIGHT_KEYS = ['CATEGORY_OVERLAP', 'BUDGET_FIT', 'LOCATION_MATCH', 'COMPLETENESS'];

/**
 * Typed settings registry: validation and side effects for each key in one
 * place, so adding a setting is one object literal and nothing else.
 */
const REGISTRY = {
  algorithm_weights: {
    type: 'weights',
    description: 'Feed relevance scoring. Must total 100.',
    schema: Object.fromEntries(WEIGHT_KEYS.map((k) => [k, 'integer 0-100'])),
    validate(v) {
      const out = {};
      for (const k of WEIGHT_KEYS) {
        const n = Number(v?.[k]);
        // The old endpoint coerced a missing value to 0 and accepted negatives
        // and any total; feedRanking then applied them verbatim, so a single
        // typo could invert the feed.
        if (!Number.isFinite(n) || n < 0 || n > 100) throw badValue(`${k} must be a number from 0 to 100`);
        out[k] = n;
      }
      const total = WEIGHT_KEYS.reduce((s, k) => s + out[k], 0);
      if (total !== 100) throw badValue(`Weights must total 100 (got ${total})`);
      return out;
    },
    onChange: () => require('./feedRanking').invalidateWeights(),
  },

  feature_flags: {
    type: 'flags',
    description: 'Boolean switches read by the API and shipped to the app.',
    schema: { '<flag_name>': 'boolean' },
    validate(v) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw badValue('feature_flags must be an object');
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        if (!/^[a-z0-9_]{2,40}$/.test(k)) throw badValue(`Bad flag name: ${k} (lowercase, digits and _ only)`);
        if (typeof val !== 'boolean') throw badValue(`Flag ${k} must be true or false`);
        out[k] = val;
      }
      if (Object.keys(out).length > 50) throw badValue('Too many flags (max 50)');
      return out;
    },
    onChange: () => sharedCache.del(cacheKey('feature_flags')),
  },

  maintenance_mode: {
    type: 'maintenance',
    description: 'When enabled, non-admin API traffic gets a 503.',
    schema: { enabled: 'boolean', message: 'string (<=300)', allow_admins: 'boolean' },
    validate(v) {
      if (typeof v?.enabled !== 'boolean') throw badValue('enabled must be true or false');
      return {
        enabled: v.enabled,
        message: String(v.message ?? 'Matchr is down for maintenance. Back shortly.').slice(0, 300),
        allow_admins: v.allow_admins !== false,
      };
    },
    // Refresh the middleware's in-process flag too, so the instance the
    // operator just talked to switches immediately instead of on its next tick.
    onChange: async () => {
      await sharedCache.del(cacheKey('maintenance_mode'));
      await require('../middleware/maintenanceMode').refresh();
    },
  },
};

const cacheKey = (key) => `settings:${key}`;
const SETTING_TTL_SECONDS = 30;

function isKnownKey(key) {
  return Object.prototype.hasOwnProperty.call(REGISTRY, key);
}

/** Reads one setting through the shared cache, with the registry default. */
async function getSetting(key, fallback = null) {
  const cached = await sharedCache.get(cacheKey(key));
  if (cached !== undefined) return cached;

  const { rows } = await db.query('SELECT value FROM admin_settings WHERE key = $1', [key]);
  const value = rows[0]?.value ?? fallback;
  await sharedCache.set(cacheKey(key), value, SETTING_TTL_SECONDS);
  return value;
}

async function listSettings() {
  const { rows } = await db.query(
    'SELECT key, value, description, updated_at, updated_by FROM admin_settings ORDER BY key'
  );
  return rows.map((row) => ({
    ...row,
    type: REGISTRY[row.key]?.type ?? 'json',
    schema: REGISTRY[row.key]?.schema ?? null,
    // A key present in the DB but not the registry is not editable through the
    // panel — there is nothing to validate it against.
    editable: isKnownKey(row.key),
  }));
}

/**
 * Validates, persists, busts the cache and runs the key's side effect.
 * Returns { before, after } so the caller can put the diff in the audit row.
 */
async function updateSetting(key, rawValue, adminId) {
  const entry = REGISTRY[key];
  if (!entry) {
    const err = new Error(`Unknown setting: ${key}`);
    err.statusCode = 404;
    err.expose = true;
    throw err;
  }

  const value = entry.validate(rawValue);

  const { rows: [before] } = await db.query('SELECT value FROM admin_settings WHERE key = $1', [key]);
  const { rows: [after] } = await db.query(
    `INSERT INTO admin_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by
     RETURNING key, value, description, updated_at, updated_by`,
    [key, JSON.stringify(value), adminId || null]
  );

  await sharedCache.del(cacheKey(key));
  await entry.onChange?.();

  return { before: before?.value ?? null, after };
}

module.exports = {
  REGISTRY,
  WEIGHT_KEYS,
  badValue,
  isKnownKey,
  getSetting,
  listSettings,
  updateSetting,
  cacheKey,
};
