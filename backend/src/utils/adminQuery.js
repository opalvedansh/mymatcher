/**
 * Shared query helpers for the admin list endpoints.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * reports.target_id is TEXT while post/story/message ids are UUID. A single
 * malformed value in `WHERE id = ANY($1::uuid[])` fails the whole query with a
 * 22P02 and takes an entire moderation queue page down, so ids are filtered
 * here rather than trusted.
 */
function onlyUuids(ids) {
  return [...new Set(ids.filter((id) => typeof id === 'string' && UUID_RE.test(id)))];
}

/** Escapes LIKE wildcards so a search for `_` does not match every row. */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Keyset cursor over (created_at, id). base64 rather than two query params so
 * the client treats it as opaque and cannot hand-craft one.
 */
function encodeCursor(createdAt, id) {
  const ts = createdAt instanceof Date ? createdAt.toISOString() : String(createdAt);
  return Buffer.from(`${ts}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  const raw = Buffer.from(String(cursor), 'base64url').toString('utf8');
  const sep = raw.lastIndexOf('|');
  if (sep < 1) return null;
  const ts = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (Number.isNaN(Date.parse(ts)) || !id) return null;
  return { ts, id };
}

function clampLimit(value, fallback = 50, max = 100) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/** Turns 'true'/'false'/'1'/'0' into a boolean, or undefined when absent. */
function boolParam(value) {
  if (value === undefined || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

module.exports = { UUID_RE, onlyUuids, escapeLike, encodeCursor, decodeCursor, clampLimit, boolParam };
