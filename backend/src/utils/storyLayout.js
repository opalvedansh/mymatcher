// The story editor's layout (src/features/story/layout.ts in the app): what is
// placed over a story's photo on a 1080×1920 canvas. Every viewer's app draws
// it, so it is rebuilt here from known fields only — anything unexpected is
// dropped or refused, never passed through to other people's phones.

const MAX_BYTES = 200 * 1024;
const MAX_LAYERS = 60;
const MAX_STROKES = 400;
const MAX_PATH = 24000;
const MAX_TEXT = 500;

const FONTS = new Set(['classic', 'modern', 'neon', 'typewriter', 'strong', 'serif']);
const TEXT_BGS = new Set(['none', 'solid', 'soft']);
const ALIGNS = new Set(['left', 'center', 'right']);
const BRUSHES = new Set(['pen', 'marker', 'neon', 'arrow']);
const FILTERS = new Set(['normal', 'clarendon', 'juno', 'lark', 'gingham', 'mono', 'sepia', 'cool', 'warm', 'fade']);
const STICKERS = new Set(['emoji', 'time', 'date']);
const MUSIC_STYLES = new Set(['card', 'mini']);
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// Only the commands the editor writes, and numbers.
const PATH_RE = /^[MLQ0-9 .-]*$/;

class LayoutError extends Error {}

function fail(msg) {
  throw new LayoutError(msg);
}

function num(v, min, max, name) {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${name} must be a number`);
  return Math.min(max, Math.max(min, v));
}

function oneOf(v, set, name) {
  if (!set.has(v)) fail(`${name} is not supported`);
  return v;
}

function color(v, name) {
  if (typeof v !== 'string' || !COLOR_RE.test(v)) fail(`${name} must be a #RRGGBB colour`);
  return v.toUpperCase();
}

/** An https URL on one of `hosts` (or a subdomain of one), or a LayoutError. */
function httpsUrl(v, hosts, name) {
  let u;
  try {
    u = new URL(v);
  } catch {
    fail(`${name} must be a URL`);
  }
  const ok = u.protocol === 'https:' && hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  if (!ok || v.length > 1000) fail(`${name} is not an allowed URL`);
  return u.href;
}

function shortText(v, max, name) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) fail(`${name} must be 1–${max} characters`);
  return v;
}

/**
 * The song on a story: an Apple Music 30-second preview (from GET
 * /api/stories/music). Only Apple's own hosts are accepted, so a story can't
 * make every viewer's phone fetch an arbitrary URL.
 */
function music(m) {
  if (!m || typeof m !== 'object') fail('layout.music must be an object');
  return {
    id: Math.trunc(num(m.id, 1, Number.MAX_SAFE_INTEGER, 'music.id')),
    title: shortText(m.title, 200, 'music.title'),
    artist: shortText(m.artist, 200, 'music.artist'),
    artwork: m.artwork == null ? null : httpsUrl(m.artwork, ['mzstatic.com'], 'music.artwork'),
    preview: httpsUrl(m.preview, ['apple.com', 'mzstatic.com'], 'music.preview'),
    url: m.url == null ? null : httpsUrl(m.url, ['apple.com'], 'music.url'),
    start: num(m.start, 0, 30, 'music.start'),
  };
}

function placement(p, name) {
  return {
    x: num(p.x, -4000, 6000, `${name}.x`),
    y: num(p.y, -4000, 6000, `${name}.y`),
    scale: num(p.scale, 0.05, 20, `${name}.scale`),
    rotation: num(p.rotation, -100, 100, `${name}.rotation`),
  };
}

function layer(l, i) {
  const name = `layers[${i}]`;
  if (!l || typeof l !== 'object') fail(`${name} must be an object`);
  const id = typeof l.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(l.id) ? l.id : fail(`${name}.id is invalid`);
  if (typeof l.text !== 'string' && l.type !== 'music') fail(`${name}.text must be a string`);
  if (l.type === 'text') {
    if (!l.text.trim() || l.text.length > MAX_TEXT) fail(`${name}.text must be 1–${MAX_TEXT} characters`);
    return {
      id,
      type: 'text',
      text: l.text,
      font: oneOf(l.font, FONTS, `${name}.font`),
      color: color(l.color, `${name}.color`),
      bg: oneOf(l.bg, TEXT_BGS, `${name}.bg`),
      align: oneOf(l.align, ALIGNS, `${name}.align`),
      size: num(l.size, 8, 400, `${name}.size`),
      ...placement(l, name),
    };
  }
  if (l.type === 'sticker') {
    if (!l.text.trim() || l.text.length > 40) fail(`${name}.text must be 1–40 characters`);
    return {
      id,
      type: 'sticker',
      kind: oneOf(l.kind, STICKERS, `${name}.kind`),
      text: l.text,
      size: num(l.size, 8, 600, `${name}.size`),
      ...placement(l, name),
    };
  }
  if (l.type === 'mention') {
    // The shown name is replaced with the real one by the caller, so a
    // mention can't read as one person and link to another.
    if (typeof l.userId !== 'string' || !l.userId || l.userId.length > 128) fail(`${name}.userId is invalid`);
    return {
      id,
      type: 'mention',
      userId: l.userId,
      text: l.text.slice(0, 80),
      size: num(l.size, 8, 400, `${name}.size`),
      ...placement(l, name),
    };
  }
  if (l.type === 'music') {
    return {
      id,
      type: 'music',
      text: '',
      style: oneOf(l.style, MUSIC_STYLES, `${name}.style`),
      size: num(l.size, 8, 400, `${name}.size`),
      ...placement(l, name),
    };
  }
  return fail(`${name}.type is not supported`);
}

function stroke(s, i) {
  const name = `strokes[${i}]`;
  if (!s || typeof s !== 'object') fail(`${name} must be an object`);
  if (typeof s.d !== 'string' || !s.d || s.d.length > MAX_PATH || !PATH_RE.test(s.d)) fail(`${name}.d is invalid`);
  return {
    brush: oneOf(s.brush, BRUSHES, `${name}.brush`),
    color: color(s.color, `${name}.color`),
    width: num(s.width, 1, 300, `${name}.width`),
    d: s.d,
  };
}

/**
 * The layout to store, rebuilt from known fields. Throws a LayoutError with a
 * message fit for a 400 response when something is missing or out of shape.
 */
function sanitizeLayout(raw, { hasMedia, isVideo = false }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('layout must be an object');
  if (raw.v !== 1) fail('layout version is not supported');
  if (JSON.stringify(raw).length > MAX_BYTES) fail('layout is too large');
  if (!Array.isArray(raw.layers) || raw.layers.length > MAX_LAYERS) fail(`layout.layers must be a list of at most ${MAX_LAYERS}`);
  if (!Array.isArray(raw.strokes) || raw.strokes.length > MAX_STROKES) fail(`layout.strokes must be a list of at most ${MAX_STROKES}`);

  let bg;
  // A video can't be blurred behind itself; its background is a gradient.
  if (raw.bg?.kind === 'blur' && hasMedia && !isVideo) bg = { kind: 'blur' };
  else if (raw.bg?.kind === 'gradient' && Array.isArray(raw.bg.colors) && raw.bg.colors.length === 2) {
    bg = { kind: 'gradient', colors: raw.bg.colors.map((c, i) => color(c, `bg.colors[${i}]`)) };
  } else fail('layout.bg is invalid');

  let photo = null;
  if (hasMedia) {
    const p = raw.photo;
    if (!p || typeof p !== 'object') fail('layout.photo is required with a photo');
    photo = {
      w: num(p.w, 1, 20000, 'photo.w'),
      h: num(p.h, 1, 20000, 'photo.h'),
      ...placement(p, 'photo'),
      filter: oneOf(p.filter, FILTERS, 'photo.filter'),
    };
  }

  const layers = raw.layers.map(layer);
  const strokes = raw.strokes.map(stroke);
  const song = raw.music == null ? null : music(raw.music);
  if (!song && layers.some((l) => l.type === 'music')) fail('a music sticker needs a song');
  if (!hasMedia && !layers.length && !strokes.length) fail('a story without a photo needs text, a sticker or a drawing');

  return { v: 1, bg, photo, strokes, layers, music: song, videoMuted: raw.videoMuted === true };
}

module.exports = { sanitizeLayout, LayoutError };
