/**
 * Formatting helpers.
 *
 * Dates render in the business's timezone, not the operator's browser: the
 * metrics API buckets days in Asia/Kolkata, and a table that disagrees with
 * the chart above it is worse than one that is a few hours off for whoever is
 * travelling.
 */
export const TZ = 'Asia/Kolkata';

const dt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
const dOnly = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
const dShort = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short' });

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dt.format(d);
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dOnly.format(d);
}

export function fmtDayShort(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? value : dShort.format(d);
}

/** "3 min ago" for recency, where the exact clock time is not the point. */
export function fmtRelative(value: string | null | undefined): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(value);
}

const nf = new Intl.NumberFormat('en-IN');
export const fmtNum = (n: number | string | null | undefined): string =>
  n === null || n === undefined || n === '' ? '—' : nf.format(Number(n));

/** Compact form for axis ticks, where digits cost horizontal room. */
export function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export const fmtPct = (n: number | null | undefined, digits = 1): string =>
  n === null || n === undefined ? '—' : `${Number(n).toFixed(digits)}%`;

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

/** First letters of a name, for an avatar with no image. */
export function initials(name: string | null | undefined, fallback = '?'): string {
  if (!name?.trim()) return fallback;
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join('');
}

export const shortId = (id: string | null | undefined, n = 8): string =>
  !id ? '—' : id.length <= n ? id : `${id.slice(0, n)}…`;

/** An ISO day string N days before today, for default date ranges. */
export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export const isoToday = (): string => new Date().toISOString().slice(0, 10);

/** Turns `user.hard_delete` into `User hard delete` for the audit table. */
export function humanizeAction(action: string): string {
  const cleaned = action.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/, '');
  const text = cleaned.replace(/[._/]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
