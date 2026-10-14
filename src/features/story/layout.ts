import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWindowDimensions } from 'react-native';

// A story is stored as its original photo plus a layout: where the photo sits,
// what is drawn and written over it, and the background behind it. The viewer
// draws the same layout the editor did, so nothing is flattened into a new
// image. That keeps text sharp at any screen size and needs no native image
// module, so it ships to existing binaries over the air.
//
// Everything is placed on a fixed 1080×1920 (9:16) canvas, then scaled to the
// screen, so a story looks the same on every phone.
export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

export type FontId = 'classic' | 'modern' | 'neon' | 'typewriter' | 'strong' | 'serif';
export type TextBg = 'none' | 'solid' | 'soft';
export type TextAlign = 'left' | 'center' | 'right';
export type BrushId = 'pen' | 'marker' | 'neon' | 'arrow';
export type FilterId = 'normal' | 'clarendon' | 'juno' | 'lark' | 'gingham' | 'mono' | 'sepia' | 'cool' | 'warm' | 'fade';

/** Position, size and turn shared by everything that can be moved on the canvas. */
export type Placement = {
  /** Centre, in canvas units. */
  x: number;
  y: number;
  scale: number;
  /** Radians. */
  rotation: number;
};

export type TextLayer = Placement & {
  id: string;
  type: 'text';
  text: string;
  font: FontId;
  color: string;
  bg: TextBg;
  align: TextAlign;
  /** Font size in canvas units, before `scale`. */
  size: number;
};

/** Emoji and the time/date stickers: plain glyphs with no text styling. */
export type StickerLayer = Placement & {
  id: string;
  type: 'sticker';
  kind: 'emoji' | 'time' | 'date';
  text: string;
  size: number;
};

export type Layer = TextLayer | StickerLayer;

export type Stroke = {
  brush: BrushId;
  color: string;
  /** Stroke width in canvas units. */
  width: number;
  /** SVG path in canvas units. */
  d: string;
};

export type StoryBackground =
  | { kind: 'blur' }
  | { kind: 'gradient'; colors: [string, string] };

export type StoryPhoto = Placement & {
  /** Size of the photo's box at scale 1, in canvas units (the photo's own aspect ratio). */
  w: number;
  h: number;
  filter: FilterId;
};

export type StoryLayout = {
  v: 1;
  bg: StoryBackground;
  photo: StoryPhoto | null;
  strokes: Stroke[];
  layers: Layer[];
};

// ─── Canvas geometry ──────────────────────────────────────────────

export type CanvasFrame = { width: number; height: number; top: number; left: number; k: number };

/**
 * Where the 9:16 canvas sits on this screen: full width under the status bar,
 * as tall as the width allows, with the space left at the bottom for the
 * reply bar (or the share buttons in the editor). A screen too short for that
 * fits the canvas by height instead.
 */
export function useCanvasFrame(reserveBottom: number): CanvasFrame {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const available = height - insets.top - reserveBottom - insets.bottom;
  let w = width;
  let h = (width * CANVAS_H) / CANVAS_W;
  if (h > available) {
    h = Math.max(available, 0);
    w = (h * CANVAS_W) / CANVAS_H;
  }
  return { width: w, height: h, top: insets.top, left: (width - w) / 2, k: w / CANVAS_W };
}

/** The photo's box at scale 1, fitted inside the canvas or covering it. */
export function fitPhoto(imgW: number, imgH: number, mode: 'contain' | 'cover'): StoryPhoto {
  const aspect = imgW > 0 && imgH > 0 ? imgW / imgH : CANVAS_W / CANVAS_H;
  const byWidth = { w: CANVAS_W, h: CANVAS_W / aspect };
  const byHeight = { w: CANVAS_H * aspect, h: CANVAS_H };
  const widthFits = byWidth.h <= CANVAS_H;
  const box = mode === 'contain' ? (widthFits ? byWidth : byHeight) : (widthFits ? byHeight : byWidth);
  return { ...box, x: CANVAS_W / 2, y: CANVAS_H / 2, scale: 1, rotation: 0, filter: 'normal' };
}

/**
 * Stories posted before the editor have no layout. They are shown whole over
 * a blurred copy of themselves; the photo's own size is unknown, so its box
 * is the whole canvas and the image is contained inside it.
 */
export function legacyLayout(): StoryLayout {
  return {
    v: 1,
    bg: { kind: 'blur' },
    photo: { w: CANVAS_W, h: CANVAS_H, x: CANVAS_W / 2, y: CANVAS_H / 2, scale: 1, rotation: 0, filter: 'normal' },
    strokes: [],
    layers: [],
  };
}

/** A layout from the server, or the legacy default when it is missing or from a newer app. */
export function readLayout(raw: unknown, hasMedia: boolean): StoryLayout {
  const l = raw as StoryLayout | null | undefined;
  if (l && l.v === 1 && Array.isArray(l.layers) && Array.isArray(l.strokes)) {
    // A photo story always draws its photo, or the viewer would wait forever for it to load.
    return { ...l, photo: hasMedia ? (l.photo ?? legacyLayout().photo) : null };
  }
  return legacyLayout();
}

// ─── Styling ──────────────────────────────────────────────────────

export const PALETTE = [
  '#FFFFFF', '#000000', '#3897F0', '#70C050', '#FDCB5C', '#FD8D32', '#ED4956', '#D10869', '#A307BA',
  '#FF6B2B', '#F7B7C8', '#FFE1C7', '#C9F2C7', '#A7E8FF', '#262626', '#8E8E8E', '#D9D9D9', '#6C4B2F',
];

/** Backgrounds for text-only stories; tapping the canvas cycles through them. */
export const GRADIENTS: [string, string][] = [
  ['#FF6B2B', '#D10869'],
  ['#3897F0', '#A307BA'],
  ['#0F2027', '#2C5364'],
  ['#F7971E', '#FFD200'],
  ['#11998E', '#38EF7D'],
  ['#232526', '#414345'],
  ['#EE9CA7', '#FFDDE1'],
];

type FontStyle = {
  label: string;
  family?: string;
  weight: '400' | '600' | '700' | '800' | '900';
  italic?: boolean;
  upper?: boolean;
  letterSpacing?: number;
  /** Text glow in the text colour (the neon look). */
  glow?: boolean;
};

// System fonts only, so nothing has to be downloaded or bundled.
export const FONTS: Record<FontId, FontStyle> = {
  classic: { label: 'Classic', weight: '600' },
  modern: {
    label: 'Modern',
    family: Platform.select({ ios: 'Futura', android: 'sans-serif-medium', default: 'Futura, "Trebuchet MS", sans-serif' }),
    weight: '700',
    letterSpacing: 0.04,
  },
  neon: {
    label: 'Neon',
    family: Platform.select({ ios: 'Noteworthy', android: 'casual', default: '"Comic Sans MS", cursive' }),
    weight: '700',
    glow: true,
  },
  typewriter: {
    label: 'Typewriter',
    family: Platform.select({ ios: 'American Typewriter', android: 'monospace', default: '"Courier New", monospace' }),
    weight: '400',
  },
  strong: { label: 'Strong', weight: '900', italic: true, upper: true },
  serif: {
    label: 'Serif',
    family: Platform.select({ ios: 'Didot', android: 'serif', default: 'Georgia, serif' }),
    weight: '700',
  },
};
export const FONT_ORDER: FontId[] = ['classic', 'modern', 'neon', 'typewriter', 'strong', 'serif'];

/** Black or white, whichever reads better on `hex`. */
export function contrastOn(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#000000' : '#FFFFFF';
}

/**
 * Colour filters, drawn as layers blended over the photo. Native image filters
 * would need a new native module; blend modes are built into React Native.
 */
export type FilterPass = {
  color: string;
  opacity: number;
  blend: 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'color' | 'saturation' | 'luminosity';
};
export const FILTERS: Record<FilterId, { label: string; passes: FilterPass[] }> = {
  normal: { label: 'Normal', passes: [] },
  clarendon: { label: 'Clarendon', passes: [{ color: '#7FBBE3', opacity: 0.25, blend: 'overlay' }, { color: '#000000', opacity: 0.08, blend: 'overlay' }] },
  juno: { label: 'Juno', passes: [{ color: '#FFB27A', opacity: 0.22, blend: 'soft-light' }, { color: '#127A8A', opacity: 0.12, blend: 'overlay' }] },
  lark: { label: 'Lark', passes: [{ color: '#F2F2F2', opacity: 0.16, blend: 'screen' }, { color: '#7FB5D9', opacity: 0.12, blend: 'soft-light' }] },
  gingham: { label: 'Gingham', passes: [{ color: '#E6E6FA', opacity: 0.3, blend: 'soft-light' }, { color: '#FFFFFF', opacity: 0.12, blend: 'normal' }] },
  mono: { label: 'Mono', passes: [{ color: '#FFFFFF', opacity: 1, blend: 'saturation' }] },
  sepia: { label: 'Sepia', passes: [{ color: '#FFFFFF', opacity: 1, blend: 'saturation' }, { color: '#A0703C', opacity: 0.45, blend: 'color' }] },
  cool: { label: 'Cool', passes: [{ color: '#3A7BD5', opacity: 0.25, blend: 'soft-light' }] },
  warm: { label: 'Warm', passes: [{ color: '#FF8C00', opacity: 0.25, blend: 'soft-light' }] },
  fade: { label: 'Fade', passes: [{ color: '#FFFFFF', opacity: 0.18, blend: 'normal' }, { color: '#C8B49B', opacity: 0.15, blend: 'soft-light' }] },
};
export const FILTER_ORDER: FilterId[] = ['normal', 'clarendon', 'juno', 'lark', 'gingham', 'mono', 'sepia', 'cool', 'warm', 'fade'];

export const BRUSHES: Record<BrushId, { label: string; icon: string; defaultWidth: number }> = {
  pen: { label: 'Pen', icon: 'pencil', defaultWidth: 14 },
  marker: { label: 'Marker', icon: 'marker', defaultWidth: 36 },
  neon: { label: 'Neon', icon: 'lightbulb-on-outline', defaultWidth: 16 },
  arrow: { label: 'Arrow', icon: 'arrow-top-right', defaultWidth: 14 },
};
export const BRUSH_ORDER: BrushId[] = ['pen', 'arrow', 'marker', 'neon'];

// ─── Drawing ──────────────────────────────────────────────────────

export type Point = { x: number; y: number };

/** A smooth SVG path through the points (quadratic curves through midpoints). */
export function pathFromPoints(pts: Point[]): string {
  if (pts.length === 0) return '';
  const r = (n: number) => Math.round(n);
  if (pts.length < 3) {
    const [a, b = a] = pts;
    return `M${r(a.x)} ${r(a.y)}L${r(b.x)} ${r(b.y)}`;
  }
  let d = `M${r(pts[0].x)} ${r(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += `Q${r(pts[i].x)} ${r(pts[i].y)} ${r(mx)} ${r(my)}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${r(last.x)} ${r(last.y)}`;
}

/** Arrowhead lines at the end of a stroke, pointing the way it was drawn. */
export function arrowHead(pts: Point[], width: number): string {
  if (pts.length < 2) return '';
  const end = pts[pts.length - 1];
  // Look back far enough that the last jittery points don't set the direction.
  let from = pts[0];
  for (let i = pts.length - 2; i >= 0; i--) {
    if (Math.hypot(end.x - pts[i].x, end.y - pts[i].y) > width * 3) {
      from = pts[i];
      break;
    }
  }
  const angle = Math.atan2(end.y - from.y, end.x - from.x);
  const len = Math.max(40, width * 4);
  const spread = Math.PI / 6;
  const r = (n: number) => Math.round(n);
  const a = { x: end.x - len * Math.cos(angle - spread), y: end.y - len * Math.sin(angle - spread) };
  const b = { x: end.x - len * Math.cos(angle + spread), y: end.y - len * Math.sin(angle + spread) };
  return `M${r(a.x)} ${r(a.y)}L${r(end.x)} ${r(end.y)}L${r(b.x)} ${r(b.y)}`;
}

/** The points an SVG path from `pathFromPoints` passes through, for hit-testing the eraser. */
export function pathPoints(d: string): Point[] {
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const pts: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

export const newId = () => Math.random().toString(36).slice(2, 10);
