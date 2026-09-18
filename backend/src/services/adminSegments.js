const { badValue } = require('./adminSettings');

/**
 * Compiles a broadcast segment into SQL.
 *
 * Every field is whitelisted and every value is a bound parameter. An admin
 * panel that accepts a WHERE clause is remote code execution with extra
 * steps, so anything not named here is a 422 rather than a passthrough.
 */
const MAX_USER_IDS = 1000;
const MAX_CATEGORIES = 20;

const ALLOWED_KEYS = new Set([
  'role', 'banned', 'verified', 'verification_status', 'has_push_token',
  'categories', 'location', 'created_from', 'created_to', 'user_ids',
]);

function buildSegmentWhere(segment = {}) {
  if (typeof segment !== 'object' || segment === null || Array.isArray(segment)) {
    throw badValue('segment must be an object');
  }

  for (const key of Object.keys(segment)) {
    if (!ALLOWED_KEYS.has(key)) throw badValue(`Unknown segment field: ${key}`);
  }

  const where = ['u.deleted_at IS NULL'];
  const params = [];
  const add = (value) => `$${params.push(value)}`;

  // Default to excluding banned users: a broadcast to people you have banned
  // is almost always a mistake, so it has to be asked for explicitly.
  if (segment.banned === true) where.push('u.banned = true');
  else where.push('u.banned = false');

  if (segment.role !== undefined) {
    if (!['brand', 'influencer'].includes(segment.role)) throw badValue('role must be brand or influencer');
    where.push(`u.role = ${add(segment.role)}::user_role`);
  }

  if (segment.has_push_token === true) where.push('u.expo_push_token IS NOT NULL');
  if (segment.has_push_token === false) where.push('u.expo_push_token IS NULL');

  if (segment.verified !== undefined) {
    if (typeof segment.verified !== 'boolean') throw badValue('verified must be true or false');
    where.push(`COALESCE(bp.verified, ip.verified, false) = ${add(segment.verified)}`);
  }

  if (segment.verification_status !== undefined) {
    const allowed = ['none', 'pending', 'approved', 'rejected'];
    if (!allowed.includes(segment.verification_status)) {
      throw badValue(`verification_status must be one of ${allowed.join(', ')}`);
    }
    where.push(`bp.verification_status = ${add(segment.verification_status)}`);
  }

  if (segment.categories !== undefined) {
    if (!Array.isArray(segment.categories) || !segment.categories.length) {
      throw badValue('categories must be a non-empty array');
    }
    if (segment.categories.length > MAX_CATEGORIES) throw badValue(`Too many categories (max ${MAX_CATEGORIES})`);
    if (segment.categories.some((c) => typeof c !== 'string')) throw badValue('categories must be strings');
    const p = add(segment.categories);
    where.push(`(bp.categories && ${p}::text[] OR ip.categories && ${p}::text[])`);
  }

  if (segment.location !== undefined) {
    if (typeof segment.location !== 'string' || segment.location.length < 2) {
      throw badValue('location must be at least 2 characters');
    }
    // Escaped so a location of "_" does not match everything.
    const p = add(`%${escapeLike(segment.location)}%`);
    where.push(`(bp.location ILIKE ${p} OR ip.location ILIKE ${p})`);
  }

  if (segment.created_from !== undefined) {
    assertIsoDay(segment.created_from, 'created_from');
    where.push(`u.created_at >= ${add(segment.created_from)}::date`);
  }
  if (segment.created_to !== undefined) {
    assertIsoDay(segment.created_to, 'created_to');
    where.push(`u.created_at < (${add(segment.created_to)}::date + 1)`);
  }

  if (segment.user_ids !== undefined) {
    if (!Array.isArray(segment.user_ids) || !segment.user_ids.length) {
      throw badValue('user_ids must be a non-empty array');
    }
    if (segment.user_ids.length > MAX_USER_IDS) throw badValue(`Too many user_ids (max ${MAX_USER_IDS})`);
    if (segment.user_ids.some((id) => typeof id !== 'string' || id.length > 128)) {
      throw badValue('user_ids must be strings of at most 128 characters');
    }
    where.push(`u.id = ANY(${add(segment.user_ids)}::text[])`);
  }

  return {
    sql: where.join('\n    AND '),
    params,
    // Both profile tables are joined so a segment can filter on either without
    // the caller knowing which role it is targeting.
    from: `users u
      LEFT JOIN brand_profiles      bp ON bp.user_id = u.id
      LEFT JOIN influencer_profiles ip ON ip.user_id = u.id`,
  };
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function assertIsoDay(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw badValue(`${field} must be YYYY-MM-DD`);
}

module.exports = { buildSegmentWhere, escapeLike, ALLOWED_KEYS, MAX_USER_IDS };
