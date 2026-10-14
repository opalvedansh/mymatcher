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
  if (typeof l.text !== 'string') fail(`${name}.text must be a string`);
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
function sanitizeLayout(raw, { hasMedia }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('layout must be an object');
  if (raw.v !== 1) fail('layout version is not supported');
  if (JSON.stringify(raw).length > MAX_BYTES) fail('layout is too large');
  if (!Array.isArray(raw.layers) || raw.layers.length > MAX_LAYERS) fail(`layout.layers must be a list of at most ${MAX_LAYERS}`);
  if (!Array.isArray(raw.strokes) || raw.strokes.length > MAX_STROKES) fail(`layout.strokes must be a list of at most ${MAX_STROKES}`);

  let bg;
  if (raw.bg?.kind === 'blur' && hasMedia) bg = { kind: 'blur' };
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
  if (!hasMedia && !layers.length && !strokes.length) fail('a story without a photo needs text, a sticker or a drawing');

  return { v: 1, bg, photo, strokes, layers };
}

module.exports = { sanitizeLayout, LayoutError };
