const db = require('../config/db');
const sharedCache = require('../utils/sharedCache');

// The business runs in India; Railway runs UTC. Bucketing on created_at::date
// would draw the day boundary at 05:30 IST and make every chart look like it
// dips overnight, so the timezone is explicit and configurable.
const DEFAULT_TZ = process.env.METRICS_TZ || 'Asia/Kolkata';
const MAX_RANGE_DAYS = 366;
const STATS_TTL_SECONDS = 60;
const SERIES_TTL_SECONDS = 300;

const SERIES_COLUMNS = [
  'signups', 'brand_signups', 'influencer_signups',
  'swipes', 'likes', 'matches', 'messages', 'active_senders', 'reports',
];

/**
 * "Onboarding complete" has no server-side definition anywhere else in this
 * codebase — feedRanking admits any user with a role and a profile row. This
 * is therefore a new definition, kept in one place so the funnel and any
 * future gate cannot drift apart. If the mobile onboarding flow changes what
 * it considers finished, change it here too or the number will quietly
 * disagree with the product.
 */
const ONBOARDING_COMPLETE_SQL = `(
     (bp.user_id IS NOT NULL AND bp.name IS NOT NULL
       AND cardinality(bp.categories) > 0 AND bp.budget_max > 0)
  OR (ip.user_id IS NOT NULL AND ip.name IS NOT NULL
       AND cardinality(ip.categories) > 0 AND cardinality(ip.platforms) > 0)
)`;

// ─── Exact platform counts ───────────────────────────────────────
//
// Replaces the old reltuples mix. COALESCE(reltuples, 0) did not guard
// against -1, which is what Postgres stores for a table that has never been
// analyzed, so a freshly migrated database reported total_users: -1.
const STATS_SQL = `
  SELECT
    (SELECT count(*) FROM users WHERE deleted_at IS NULL)                            AS total_users,
    (SELECT count(*) FROM users WHERE role = 'brand'      AND deleted_at IS NULL)    AS total_brands,
    (SELECT count(*) FROM users WHERE role = 'influencer' AND deleted_at IS NULL)    AS total_influencers,
    (SELECT count(*) FROM users WHERE banned = true)                                 AS banned_users,
    (SELECT count(*) FROM users WHERE deleted_at IS NOT NULL)                        AS deleted_users,
    (SELECT count(*) FROM matches WHERE status = 'active')                           AS active_matches,
    (SELECT count(*) FROM matches WHERE status = 'archived')                         AS archived_matches,
    (SELECT count(*) FROM swipes)                                                    AS total_swipes,
    (SELECT count(*) FROM messages)                                                  AS total_messages,
    (SELECT count(*) FROM brand_profiles WHERE verification_status = 'pending')      AS pending_verifications,
    (SELECT count(*) FROM reports WHERE status = 'open')                             AS open_reports,
    (SELECT count(*) FROM users    WHERE created_at >= now() - interval '24 hours')  AS signups_24h,
    (SELECT count(*) FROM matches  WHERE matched_at >= now() - interval '24 hours')  AS matches_24h,
    (SELECT count(*) FROM messages WHERE created_at >= now() - interval '24 hours')  AS messages_24h,
    (SELECT count(*) FROM swipes   WHERE created_at >= now() - interval '24 hours')  AS swipes_24h
`;

async function getStats() {
  const cached = await sharedCache.get('admin:stats');
  if (cached !== undefined) return cached;

  const { rows: [counts] } = await db.query(STATS_SQL);
  // pg returns bigint as a string to avoid precision loss; these are all well
  // inside Number range and the panel wants numbers.
  const out = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)]));
  await sharedCache.set('admin:stats', out, STATS_TTL_SECONDS);
  return out;
}

// ─── Time series ─────────────────────────────────────────────────
//
// One gap-filled query. The `created_at >= lo AND created_at < hi` predicates
// are what let the planner use the BRIN indexes from 028; the AT TIME ZONE
// conversion then happens only on rows already selected, never in the filter.
const TIMESERIES_SQL = `
WITH bounds AS (
  SELECT $1::date AS from_day, $2::date AS to_day, $3::text AS tz
),
days AS (
  SELECT generate_series(from_day, to_day, interval '1 day')::date AS day FROM bounds
),
win AS (
  SELECT (from_day::timestamp     AT TIME ZONE tz) AS lo,
         ((to_day + 1)::timestamp AT TIME ZONE tz) AS hi,
         tz
    FROM bounds
),
u AS (
  SELECT ((created_at AT TIME ZONE w.tz)::date)                AS day,
         count(*)                                             AS signups,
         count(*) FILTER (WHERE role = 'brand')                AS brand_signups,
         count(*) FILTER (WHERE role = 'influencer')           AS influencer_signups
    FROM users, win w
   WHERE created_at >= w.lo AND created_at < w.hi
   GROUP BY 1
),
s AS (
  SELECT ((created_at AT TIME ZONE w.tz)::date)                     AS day,
         count(*)                                                  AS swipes,
         count(*) FILTER (WHERE direction IN ('like','super_like')) AS likes
    FROM swipes, win w
   WHERE created_at >= w.lo AND created_at < w.hi
   GROUP BY 1
),
m AS (
  SELECT ((matched_at AT TIME ZONE w.tz)::date) AS day, count(*) AS matches
    FROM matches, win w
   WHERE matched_at >= w.lo AND matched_at < w.hi
   GROUP BY 1
),
msg AS (
  SELECT ((created_at AT TIME ZONE w.tz)::date) AS day,
         count(*)                               AS messages,
         count(DISTINCT sender_id)              AS active_senders
    FROM messages, win w
   WHERE created_at >= w.lo AND created_at < w.hi
   GROUP BY 1
),
r AS (
  SELECT ((created_at AT TIME ZONE w.tz)::date) AS day, count(*) AS reports
    FROM reports, win w
   WHERE created_at >= w.lo AND created_at < w.hi
   GROUP BY 1
)
SELECT d.day,
       COALESCE(u.signups, 0)            AS signups,
       COALESCE(u.brand_signups, 0)      AS brand_signups,
       COALESCE(u.influencer_signups, 0) AS influencer_signups,
       COALESCE(s.swipes, 0)             AS swipes,
       COALESCE(s.likes, 0)              AS likes,
       COALESCE(m.matches, 0)            AS matches,
       COALESCE(msg.messages, 0)         AS messages,
       COALESCE(msg.active_senders, 0)   AS active_senders,
       COALESCE(r.reports, 0)            AS reports
  FROM days d
  LEFT JOIN u   ON u.day   = d.day
  LEFT JOIN s   ON s.day   = d.day
  LEFT JOIN m   ON m.day   = d.day
  LEFT JOIN msg ON msg.day = d.day
  LEFT JOIN r   ON r.day   = d.day
 ORDER BY d.day
`;

function isoDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

/** Validates the range and returns { from, to, tz }, or throws a 422. */
function normalizeRange({ from, to, tz }, defaultDays = 30) {
  const toDay = isoDay(to) ? to : new Date().toISOString().slice(0, 10);
  const fallbackFrom = new Date(`${toDay}T00:00:00Z`);
  fallbackFrom.setUTCDate(fallbackFrom.getUTCDate() - (defaultDays - 1));
  const fromDay = isoDay(from) ? from : fallbackFrom.toISOString().slice(0, 10);

  if (fromDay > toDay) throw rangeError('`from` must not be after `to`');

  const spanDays = Math.round(
    (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000
  ) + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    throw rangeError(`Range too large: ${spanDays} days (max ${MAX_RANGE_DAYS})`);
  }

  return { from: fromDay, to: toDay, tz: tz || DEFAULT_TZ, days: spanDays };
}

function rangeError(message) {
  const err = new Error(message);
  err.statusCode = 422;
  err.expose = true;
  return err;
}

async function getTimeseries(range) {
  const { from, to, tz } = range;
  const key = `admin:ts:${from}:${to}:${tz}`;
  const cached = await sharedCache.get(key);
  if (cached !== undefined) return cached;

  // tz is a bound parameter, never interpolated: an unknown zone becomes a
  // Postgres error, not a SQL injection surface.
  const { rows } = await db.query(TIMESERIES_SQL, [from, to, tz]);
  const series = rows.map((row) => ({
    day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10),
    ...Object.fromEntries(SERIES_COLUMNS.map((c) => [c, Number(row[c])])),
  }));

  const out = { tz, from, to, series };
  await sharedCache.set(key, out, SERIES_TTL_SECONDS);
  return out;
}

// ─── Funnel ──────────────────────────────────────────────────────
//
// Nested by construction: every stage repeats the conditions of the ones
// before it, so the counts can only ever decrease. A "funnel" whose fourth bar
// is taller than its third is not a funnel, and that is exactly what happens
// if each stage is an independent milestone — a user who matched without
// meeting whatever definition of "onboarded" you picked appears in the later
// stage and not the earlier one.
//
// The stages mirror what the product actually gates on. Note it does NOT gate
// swiping on a complete profile — there is no completeness check anywhere in
// the codebase — so `has_profile` is the real prerequisite for appearing in a
// feed (feedRanking JOINs the profile table). The stricter "filled the profile
// in properly" measure is reported separately as `profile_complete`, because
// forcing it into the chain would invent a gate the product does not have.
//
// Two separate EXISTS for matches rather than one OR across two columns: each
// uses its own index (idx_matches_brand / idx_matches_influencer); an OR
// across columns uses neither.
const HAS_ROLE = 'u.role IS NOT NULL';
const HAS_PROFILE = '(bp.user_id IS NOT NULL OR ip.user_id IS NOT NULL)';
const HAS_SWIPED = 'EXISTS (SELECT 1 FROM swipes s WHERE s.swiper_id = u.id)';
const HAS_MATCHED = `(EXISTS (SELECT 1 FROM matches m WHERE m.brand_id = u.id)
                   OR EXISTS (SELECT 1 FROM matches m WHERE m.influencer_id = u.id))`;
const HAS_MESSAGED = 'EXISTS (SELECT 1 FROM messages ms WHERE ms.sender_id = u.id)';

const FUNNEL_SQL = `
  SELECT
    count(*)                                                                    AS signed_up,
    count(*) FILTER (WHERE ${HAS_ROLE})                                         AS role_chosen,
    count(*) FILTER (WHERE ${HAS_ROLE} AND ${HAS_PROFILE})                      AS has_profile,
    count(*) FILTER (WHERE ${HAS_ROLE} AND ${HAS_PROFILE}
                       AND ${HAS_SWIPED})                                       AS first_swipe,
    count(*) FILTER (WHERE ${HAS_ROLE} AND ${HAS_PROFILE}
                       AND ${HAS_SWIPED} AND ${HAS_MATCHED})                    AS first_match,
    count(*) FILTER (WHERE ${HAS_ROLE} AND ${HAS_PROFILE}
                       AND ${HAS_SWIPED} AND ${HAS_MATCHED}
                       AND ${HAS_MESSAGED})                                     AS first_message,
    count(*) FILTER (WHERE ${ONBOARDING_COMPLETE_SQL})                           AS profile_complete
  FROM users u
  LEFT JOIN brand_profiles      bp ON bp.user_id = u.id
  LEFT JOIN influencer_profiles ip ON ip.user_id = u.id
  WHERE u.created_at >= $1::date
    AND u.created_at <  ($2::date + 1)
    AND u.deleted_at IS NULL
    AND ($3::text IS NULL OR u.role::text = $3)
`;

const FUNNEL_STAGES = [
  ['signed_up', 'Signed up'],
  ['role_chosen', 'Chose a role'],
  ['has_profile', 'Created a profile'],
  ['first_swipe', 'Swiped'],
  ['first_match', 'Matched'],
  ['first_message', 'Sent a message'],
];

async function getFunnel({ from, to, role }) {
  const key = `admin:funnel:${from}:${to}:${role || 'all'}`;
  const cached = await sharedCache.get(key);
  if (cached !== undefined) return cached;

  const { rows: [row] } = await db.query(FUNNEL_SQL, [from, to, role || null]);
  const cohortSize = Number(row.signed_up);

  let prev = null;
  const stages = FUNNEL_STAGES.map(([field, label]) => {
    const count = Number(row[field]);
    const stage = {
      key: field,
      label,
      count,
      pct_of_start: cohortSize ? Math.round((count / cohortSize) * 1000) / 10 : 0,
      pct_of_prev: prev === null ? 100 : (prev ? Math.round((count / prev) * 1000) / 10 : 0),
    };
    prev = count;
    return stage;
  });

  const out = {
    from,
    to,
    role: role || null,
    cohort_size: cohortSize,
    stages,
    // Reported alongside the funnel rather than inside it: nothing in the
    // product requires a complete profile, so it is a quality measure, not a
    // step people pass through.
    profile_complete: {
      count: Number(row.profile_complete),
      pct_of_start: cohortSize ? Math.round((Number(row.profile_complete) / cohortSize) * 1000) / 10 : 0,
    },
  };
  await sharedCache.set(key, out, SERIES_TTL_SECONDS);
  return out;
}

// ─── Breakdowns ──────────────────────────────────────────────────
//
// A fixed map, not string interpolation: `dimension` comes straight from the
// query string.
const BREAKDOWNS = {
  role: `SELECT COALESCE(role::text, 'unset') AS key, count(*)::int AS count
           FROM users WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC`,
  verification_status: `SELECT verification_status AS key, count(*)::int AS count
           FROM brand_profiles GROUP BY 1 ORDER BY 2 DESC`,
  category: `SELECT cat AS key, count(*)::int AS count FROM (
               SELECT unnest(categories) AS cat FROM brand_profiles
               UNION ALL
               SELECT unnest(categories) AS cat FROM influencer_profiles
             ) t GROUP BY 1 ORDER BY 2 DESC LIMIT 25`,
  location: `SELECT loc AS key, count(*)::int AS count FROM (
               SELECT location AS loc FROM brand_profiles WHERE location IS NOT NULL
               UNION ALL
               SELECT location AS loc FROM influencer_profiles WHERE location IS NOT NULL
             ) t GROUP BY 1 ORDER BY 2 DESC LIMIT 25`,
  platform: `SELECT p AS key, count(*)::int AS count FROM (
               SELECT unnest(platforms) AS p FROM brand_profiles
               UNION ALL
               SELECT unnest(platforms) AS p FROM influencer_profiles
             ) t GROUP BY 1 ORDER BY 2 DESC LIMIT 25`,
};

async function getBreakdown(dimension) {
  const sql = BREAKDOWNS[dimension];
  if (!sql) throw rangeError(`Unknown dimension: ${dimension}`);
  const key = `admin:breakdown:${dimension}`;
  const cached = await sharedCache.get(key);
  if (cached !== undefined) return cached;

  const { rows } = await db.query(sql);
  await sharedCache.set(key, rows, SERIES_TTL_SECONDS);
  return rows;
}

module.exports = {
  DEFAULT_TZ,
  MAX_RANGE_DAYS,
  SERIES_COLUMNS,
  ONBOARDING_COMPLETE_SQL,
  BREAKDOWNS,
  STATS_SQL,
  TIMESERIES_SQL,
  FUNNEL_SQL,
  getStats,
  getTimeseries,
  getFunnel,
  getBreakdown,
  normalizeRange,
  rangeError,
};
