import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Directions, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { getStoryAudience, uploadImage, uploadStory, uploadStoryVideo, type StoryAudienceMember } from '@/api';
import { showAlert } from '@/components/ActionSheet';
import { canSaveToCameraRoll, getMediaLibrary, getViewShot, tapFeedback } from '@/utils/optionalModules';
import { sz } from '@/theme/scale';
import {
  BRUSH_ORDER,
  BRUSHES,
  CANVAS_H,
  CANVAS_W,
  FILTER_ORDER,
  FILTERS,
  GRADIENTS,
  arrowHead,
  fitPhoto,
  newId,
  pathFromPoints,
  pathPoints,
  useCanvasFrame,
  type BrushId,
  type FilterId,
  type Layer,
  type Placement,
  type Point,
  type StoryLayout,
  type Stroke,
  type TextLayer,
  type Track,
  MUSIC_CLIP_SECONDS,
} from './layout';
import { LayerContent, PhotoContent, StoryBackgroundView, StrokesView } from './StoryCanvas';
import { Transformable, type DragInfo } from './Transformable';
import { TextComposer } from './TextComposer';
import { StickerSheet, clockNow, dateNow } from './StickerSheet';
import { PaletteRow } from './PaletteRow';
import { VerticalSlider } from './VerticalSlider';
import { CLOSE_FRIENDS_GREEN, CloseFriendsSheet, MentionSheet, MusicSheet } from './StorySheets';
import { ClipSlider } from './ClipSlider';
import { useStoryMusic } from './media';

/** A photo or video to edit, or null for a text-only story on a coloured background. */
export type StoryDraft = {
  uri: string;
  width: number;
  height: number;
  fit: 'contain' | 'cover';
  kind?: 'image' | 'video';
  /** A video's length. */
  durationMs?: number;
} | null;

type Mode = 'idle' | 'draw' | 'filters' | 'music';
type Sheet = 'stickers' | 'music' | 'mention' | 'closeFriends' | 'closeFriendsShare' | null;
/** A video's own background: it can't be blurred behind itself. */
const VIDEO_BG: [string, string] = ['#232526', '#0F0F0F'];
/** Seconds of the 30-second preview the clip can start at. */
const MAX_CLIP_START = 30 - MUSIC_CLIP_SECONDS;
type Eraser = 'eraser';

const BOTTOM_BAR = sz(72);
const DEFAULT_TEXT: Omit<TextLayer, 'id' | 'text'> = {
  type: 'text',
  font: 'classic',
  color: '#FFFFFF',
  bg: 'none',
  align: 'center',
  size: 76,
  x: CANVAS_W / 2,
  y: CANVAS_H / 2,
  scale: 1,
  rotation: 0,
};

const strokeWidthFor = (brush: BrushId | Eraser, v: number) =>
  brush === 'eraser' ? 40 + v * 100 : brush === 'marker' ? 20 + v * 90 : 6 + v * 54;

// Eraser hit-testing needs a stroke's points; parse each path once.
const strokePointCache = new WeakMap<Stroke, Point[]>();
function strokePoints(s: Stroke) {
  let pts = strokePointCache.get(s);
  if (!pts) {
    pts = pathPoints(s.d);
    strokePointCache.set(s, pts);
  }
  return pts;
}

/** Numbers rounded so a layout with a lot of drawing stays a small request. */
function compact(layout: StoryLayout): StoryLayout {
  const r = (n: number) => Math.round(n * 100) / 100;
  const place = <T extends Placement>(p: T): T => ({ ...p, x: r(p.x), y: r(p.y), scale: r(p.scale), rotation: r(p.rotation) });
  return {
    ...layout,
    photo: layout.photo ? { ...place(layout.photo), w: r(layout.photo.w), h: r(layout.photo.h) } : null,
    layers: layout.layers.map(place),
    strokes: layout.strokes.map((s) => ({ ...s, width: r(s.width) })),
  };
}

export function StoryEditor({
  draft,
  onClose,
  onPosted,
}: {
  draft: StoryDraft;
  onClose: () => void;
  onPosted: () => void;
}) {
  const frame = useCanvasFrame(BOTTOM_BAR);
  const insets = useSafeAreaInsets();
  const k = frame.k;

  const isVideo = draft?.kind === 'video';
  const [layout, setLayout] = useState<StoryLayout>(() => ({
    v: 1,
    bg: isVideo ? { kind: 'gradient', colors: VIDEO_BG } : draft ? { kind: 'blur' } : { kind: 'gradient', colors: GRADIENTS[0] },
    photo: draft ? fitPhoto(draft.width, draft.height, draft.fit) : null,
    strokes: [],
    layers: [],
    music: null,
    videoMuted: false,
  }));
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const [mode, setMode] = useState<Mode>('idle');
  // A text-only story starts with the keyboard up, like Create mode.
  const [editing, setEditing] = useState<{ layer: TextLayer; isNew: boolean } | null>(() =>
    draft ? null : { layer: { ...DEFAULT_TEXT, id: newId(), text: '' }, isNew: true },
  );
  const [sheet, setSheet] = useState<Sheet>(null);
  const stickersOpen = sheet === 'stickers';
  const setStickersOpen = (open: boolean) => setSheet(open ? 'stickers' : null);
  const [dragging, setDragging] = useState<'layer' | 'photo' | null>(null);
  /** Which share button is posting, if any. */
  const [posting, setPosting] = useState<false | 'all' | 'close_friends'>(false);

  // The text style used last, so the next text starts from it.
  const lastText = useRef(DEFAULT_TEXT);

  // ─── Layers ────────────────────────────────────────────────────

  const updateLayer = useCallback((id: string, patch: Partial<Layer>) => {
    setLayout((l) => ({ ...l, layers: l.layers.map((x) => (x.id === id ? ({ ...x, ...patch } as Layer) : x)) }));
  }, []);

  const removeLayer = useCallback((id: string) => {
    tapFeedback();
    setLayout((l) => {
      // Throwing away the music sticker takes the song off the story.
      const gone = l.layers.find((x) => x.id === id);
      return { ...l, layers: l.layers.filter((x) => x.id !== id), music: gone?.type === 'music' ? null : l.music };
    });
  }, []);

  const addLayer = useCallback((layer: Layer) => {
    setLayout((l) => ({ ...l, layers: [...l.layers, layer] }));
  }, []);

  const startText = useCallback((prefix = '', sticker = false) => {
    const base = sticker
      ? { ...DEFAULT_TEXT, font: 'strong' as const, bg: 'solid' as const, color: '#FFFFFF' }
      : lastText.current;
    setEditing({ layer: { ...base, x: CANVAS_W / 2, y: CANVAS_H / 2, scale: 1, rotation: 0, id: newId(), text: prefix }, isNew: true });
  }, []);

  const editText = useCallback((layer: TextLayer) => {
    setEditing({ layer, isNew: false });
  }, []);

  const finishText = () => {
    if (!editing) return;
    const { layer, isNew } = editing;
    const text = layer.text.replace(/\s+$/, '');
    setEditing(null);
    if (!text.trim()) {
      if (!isNew) removeLayer(layer.id);
      return;
    }
    const { id: _id, text: _t, ...style } = layer;
    lastText.current = { ...style, x: CANVAS_W / 2, y: CANVAS_H / 2, scale: 1, rotation: 0 };
    if (isNew) addLayer({ ...layer, text });
    else updateLayer(layer.id, { ...layer, text });
  };

  const addSticker = (kind: 'emoji' | 'time' | 'date', text: string) => {
    setStickersOpen(false);
    addLayer({
      id: newId(),
      type: 'sticker',
      kind,
      text,
      size: kind === 'emoji' ? 180 : 84,
      x: CANVAS_W / 2,
      y: CANVAS_H / 2,
      scale: 1,
      rotation: 0,
    });
  };

  const addMention = (p: StoryAudienceMember) => {
    setSheet(null);
    addLayer({ id: newId(), type: 'mention', userId: p.id, text: `@${p.name}`, size: 72, x: CANVAS_W / 2, y: CANVAS_H / 2, scale: 1, rotation: 0 });
  };

  // ─── Music ─────────────────────────────────────────────────────

  const pickTrack = (t: Track) => {
    setSheet(null);
    const { duration_ms: _d, ...song } = t;
    setLayout((l) => ({
      ...l,
      music: { ...song, start: 0 },
      // One song per story, so one music sticker.
      layers: [
        ...l.layers.filter((x) => x.type !== 'music'),
        { id: newId(), type: 'music', text: '', style: 'card', size: 64, x: CANVAS_W / 2, y: CANVAS_H * 0.72, scale: 1, rotation: 0 },
      ],
    }));
    setMode('music');
  };

  const removeMusic = () => {
    setLayout((l) => ({ ...l, music: null, layers: l.layers.filter((x) => x.type !== 'music') }));
    setMode('idle');
  };

  const setClipStart = (start: number) => {
    setLayout((l) => (l.music ? { ...l, music: { ...l.music, start } } : l));
  };

  // The song plays while the story is being made, as it will for viewers;
  // it stops while another song is being picked.
  useStoryMusic(layout.music, !posting && sheet !== 'music');


  // ─── Close Friends ─────────────────────────────────────────────

  const [closeFriends, setCloseFriendsCount] = useState<number | null>(null);
  useEffect(() => {
    getStoryAudience()
      .then((people) => setCloseFriendsCount(people.filter((p: StoryAudienceMember) => p.close_friend).length))
      .catch(() => setCloseFriendsCount(null));
  }, []);

  // ─── Dragging, trash and centre guides ─────────────────────────

  const overTrash = useSharedValue(0);
  const guideX = useSharedValue(0);
  const guideY = useSharedValue(0);
  const drag: DragInfo = useMemo(() => ({ overTrash, guideX, guideY }), [overTrash, guideX, guideY]);
  const trash = useMemo(
    () => ({ x: frame.left + frame.width / 2, y: frame.top + frame.height - sz(64), radius: sz(46) }),
    [frame.left, frame.width, frame.top, frame.height],
  );
  const trashStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withTiming(overTrash.value ? 1.3 : 1, { duration: 120 }) }],
    backgroundColor: overTrash.value ? 'rgba(237,73,86,0.9)' : 'rgba(0,0,0,0.45)',
  }));
  const guideXStyle = useAnimatedStyle(() => ({ opacity: guideX.value }));
  const guideYStyle = useAnimatedStyle(() => ({ opacity: guideY.value }));

  const onLayerDragStart = useCallback(() => setDragging('layer'), []);
  const onPhotoDragStart = useCallback(() => setDragging('photo'), []);
  const onDragEnd = useCallback(() => setDragging(null), []);

  const commitPhoto = useCallback((p: Placement) => {
    setLayout((l) => (l.photo ? { ...l, photo: { ...l.photo, ...p } } : l));
  }, []);

  // ─── Drawing ───────────────────────────────────────────────────

  const [brush, setBrush] = useState<BrushId | Eraser>('pen');
  const [drawColor, setDrawColor] = useState('#FFFFFF');
  const [drawSize, setDrawSize] = useState(0.2);
  const [history, setHistory] = useState<Stroke[][]>([]);
  const [live, setLive] = useState<Stroke | null>(null);
  const points = useRef<Point[]>([]);
  const eraseStart = useRef<Stroke[] | null>(null);

  const strokeFrom = (pts: Point[]): Stroke => {
    const b = brush === 'eraser' ? 'pen' : brush;
    const width = strokeWidthFor(b, drawSize);
    const d = pathFromPoints(pts) + (b === 'arrow' && pts.length > 2 ? arrowHead(pts, width) : '');
    return { brush: b, color: drawColor, width, d };
  };

  const eraseAt = (p: Point) => {
    const reach = strokeWidthFor('eraser', drawSize) / 2;
    const strokes = layoutRef.current.strokes;
    const kept = strokes.filter((s) => !strokePoints(s).some((q) => Math.hypot(q.x - p.x, q.y - p.y) < reach + s.width / 2));
    if (kept.length !== strokes.length) setLayout((l) => ({ ...l, strokes: kept }));
  };

  const drawRef = useRef({ strokeFrom, eraseAt, brush });
  drawRef.current = { strokeFrom, eraseAt, brush };

  const drawGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .maxPointers(1)
        .onBegin((e) => {
          const p = { x: e.x / k, y: e.y / k };
          points.current = [p];
          if (drawRef.current.brush === 'eraser') {
            eraseStart.current = layoutRef.current.strokes;
            drawRef.current.eraseAt(p);
          } else {
            setLive(drawRef.current.strokeFrom(points.current));
          }
        })
        .onUpdate((e) => {
          const p = { x: e.x / k, y: e.y / k };
          const last = points.current[points.current.length - 1];
          if (last && Math.hypot(p.x - last.x, p.y - last.y) < 4) return;
          points.current.push(p);
          if (drawRef.current.brush === 'eraser') drawRef.current.eraseAt(p);
          else setLive(drawRef.current.strokeFrom(points.current));
        })
        .onFinalize(() => {
          if (drawRef.current.brush === 'eraser') {
            const before = eraseStart.current;
            if (before && before !== layoutRef.current.strokes) setHistory((h) => [...h, before]);
            eraseStart.current = null;
          } else if (points.current.length) {
            const stroke = drawRef.current.strokeFrom(points.current);
            const before = layoutRef.current.strokes;
            setHistory((h) => [...h, before]);
            setLayout((l) => ({ ...l, strokes: [...l.strokes, stroke] }));
          }
          points.current = [];
          setLive(null);
        }),
    [k],
  );

  const undoDraw = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setLayout((l) => ({ ...l, strokes: prev }));
  };

  // ─── Filters and background ────────────────────────────────────

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const showToast = useCallback((text: string, ms = 900) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  const setFilter = useCallback((f: FilterId) => {
    setLayout((l) => (l.photo ? { ...l, photo: { ...l.photo, filter: f } } : l));
    showToast(FILTERS[f].label);
  }, [showToast]);

  const stepFilter = useCallback((dir: 1 | -1) => {
    const current = layoutRef.current.photo?.filter ?? 'normal';
    const i = FILTER_ORDER.indexOf(current);
    const next = FILTER_ORDER[(i + dir + FILTER_ORDER.length) % FILTER_ORDER.length];
    tapFeedback('selection');
    setFilter(next);
  }, [setFilter]);

  // Swiping across the photo changes the filter, as in the camera.
  const filterSwipe = useMemo(
    () =>
      Gesture.Exclusive(
        Gesture.Fling().runOnJS(true).direction(Directions.RIGHT).onEnd(() => stepFilter(-1)),
        Gesture.Fling().runOnJS(true).direction(Directions.LEFT).onEnd(() => stepFilter(1)),
      ),
    [stepFilter],
  );

  const cycleBackground = () => {
    setLayout((l) => {
      const gradients = [...(isVideo ? [VIDEO_BG] : []), ...GRADIENTS].map((c) => ({ kind: 'gradient' as const, colors: c }));
      const options = [...(l.photo && !isVideo ? [{ kind: 'blur' as const }] : []), ...gradients];
      const i = options.findIndex((o) =>
        o.kind === l.bg.kind && (o.kind === 'blur' || (l.bg.kind === 'gradient' && o.colors[0] === l.bg.colors[0])),
      );
      return { ...l, bg: options[(i + 1) % options.length] };
    });
  };

  // ─── Saving to the camera roll ─────────────────────────────────

  const captureRef = useRef<View>(null);
  const [saving, setSaving] = useState(false);
  // A video is saved as it was recorded: drawing over a video needs a video
  // encoder, which the app doesn't have.
  const canSave = isVideo ? !!getMediaLibrary() : canSaveToCameraRoll();

  const save = async () => {
    const library = getMediaLibrary();
    if (!library || saving) return;
    setSaving(true);
    try {
      const perm = await library.requestPermissionsAsync(true);
      if (!perm.granted) {
        showAlert('Allow saving photos', 'Turn on photo access for Matchr in Settings to save your story.');
        return;
      }
      let uri = draft?.uri;
      if (!isVideo) {
        const shot = getViewShot();
        if (!shot || !captureRef.current) return;
        // Full story resolution, whatever the screen size.
        uri = await shot.captureRef(captureRef, { format: 'jpg', quality: 0.95, width: CANVAS_W, height: CANVAS_H, result: 'tmpfile' });
      }
      if (!uri) return;
      await library.saveToLibraryAsync(uri);
      showToast(isVideo ? 'Video saved (without stickers)' : 'Saved', 1400);
    } catch (err) {
      console.error('Failed to save story', err);
      showAlert('Couldn\'t save', 'Something went wrong while saving. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Leaving and posting ───────────────────────────────────────

  const isEmpty = !layout.photo && !layout.layers.length && !layout.strokes.length;

  const close = useCallback(() => {
    const l = layoutRef.current;
    if (!draft && !l.layers.length && !l.strokes.length) {
      onClose();
      return;
    }
    showAlert('Discard story?', 'If you go back now, you will lose your edits.', [
      { text: 'Discard', style: 'destructive', onPress: onClose },
      { text: 'Keep editing', style: 'cancel' },
    ]);
  }, [draft, onClose]);

  // Android back steps out of a tool first, then asks before discarding.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (posting) return true;
      if (editing) setEditing(null);
      else if (sheet) setSheet(null);
      else if (mode !== 'idle') setMode('idle');
      else close();
      return true;
    });
    return () => sub.remove();
  }, [editing, sheet, mode, posting, close]);

  const post = async (audience: 'all' | 'close_friends' = 'all') => {
    if (posting || isEmpty) return;
    setPosting(audience);
    try {
      const mediaUrl = !draft ? null : isVideo ? await uploadStoryVideo(draft.uri) : await uploadImage(draft.uri);
      await uploadStory({
        media_url: mediaUrl,
        layout: compact(layoutRef.current),
        media_type: isVideo ? 'video' : 'image',
        duration_ms: isVideo ? draft?.durationMs ?? null : null,
        audience,
      });
      onPosted();
    } catch (err) {
      console.error('Failed to post story', err);
      showAlert('Story not posted', 'Something went wrong while uploading. Please try again.');
      setPosting(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────

  const idle = mode === 'idle' && !editing && !posting;
  const showChrome = !dragging && !editing;
  const editingId = editing && !editing.isNew ? editing.layer.id : null;
  const photo = layout.photo;
  const mediaUri = draft?.uri ?? null;
  const videoPlayback = isVideo
    ? { paused: !!posting, muted: !!layout.videoMuted || !!layout.music, loop: true }
    : undefined;

  const canvasStyle = { top: frame.top, left: frame.left, width: frame.width, height: frame.height };

  return (
    <View style={styles.screen}>
      <View style={[styles.canvas, canvasStyle]}>
        {/* Everything the story shows, and nothing else: saving captures this view. */}
        <View ref={captureRef} collapsable={false} style={StyleSheet.absoluteFill}>
        {/* Tapping the background starts text, like tapping a story in the camera. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => idle && startText()}
          disabled={!idle}
          accessibilityLabel="Add text"
        >
          <StoryBackgroundView bg={layout.bg} mediaUri={isVideo ? null : mediaUri} />
        </Pressable>

        {photo && mediaUri && (
          <Transformable
            placement={photo}
            frame={frame}
            minScale={0.25}
            maxScale={10}
            enabled={idle}
            onCommit={commitPhoto}
            onTap={startText}
            onDragStart={onPhotoDragStart}
            onDragEnd={onDragEnd}
          >
            <View style={{ width: photo.w * k, height: photo.h * k }}>
              <PhotoContent uri={mediaUri} photo={photo} video={videoPlayback} />
            </View>
          </Transformable>
        )}

        <StrokesView strokes={layout.strokes} frame={frame} />
        {live && <StrokesView strokes={[]} live={live} frame={frame} />}

        {layout.layers.map((layer) =>
          layer.id === editingId ? null : (
            <Transformable
              key={layer.id}
              placement={layer}
              frame={frame}
              minScale={0.2}
              maxScale={8}
              enabled={idle}
              snap
              trash={trash}
              drag={drag}
              onCommit={(p) => updateLayer(layer.id, p)}
              onTap={
                layer.type === 'text'
                  ? () => editText(layer)
                  : layer.type === 'music'
                    // Tapping the music sticker switches its look, as on Instagram.
                    ? () => updateLayer(layer.id, { style: layer.style === 'card' ? 'mini' : 'card' })
                    : undefined
              }
              onDragStart={onLayerDragStart}
              onDragEnd={onDragEnd}
              onDelete={() => removeLayer(layer.id)}
            >
              <LayerContent layer={layer} k={k} music={layout.music} />
            </Transformable>
          ),
        )}

        </View>

        {!photo && !layout.layers.length && !editing && (
          <View style={styles.placeholder} pointerEvents="none">
            <Text style={styles.placeholderText}>Tap to type</Text>
          </View>
        )}

        {/* Centre guides while a layer is near the middle. */}
        <Animated.View pointerEvents="none" style={[styles.guideV, { left: frame.width / 2 }, guideXStyle]} />
        <Animated.View pointerEvents="none" style={[styles.guideH, { top: frame.height / 2 }, guideYStyle]} />

        {mode === 'draw' && (
          <GestureDetector gesture={drawGesture}>
            <View style={StyleSheet.absoluteFill} collapsable={false} />
          </GestureDetector>
        )}
        {mode === 'filters' && (
          <GestureDetector gesture={filterSwipe}>
            <View style={StyleSheet.absoluteFill} collapsable={false} />
          </GestureDetector>
        )}

        {toast && (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}
      </View>

      {/* Trash target while a layer is being dragged. */}
      {dragging === 'layer' && (
        <Animated.View
          pointerEvents="none"
          style={[styles.trash, { left: trash.x - sz(28), top: trash.y - sz(28) }, trashStyle]}
        >
          <Ionicons name="trash-outline" size={sz(26)} color="#FFF" />
        </Animated.View>
      )}

      {/* ── Close, and the tools down the right side ── */}
      {showChrome && mode === 'idle' && (
        <>
          <View style={[styles.closeBtn, { top: frame.top + sz(8), left: frame.left + sz(8) }]} pointerEvents={posting ? 'none' : 'auto'}>
            <ToolButton icon={<Ionicons name="close" size={sz(30)} color="#FFF" />} label="Close" onPress={close} />
          </View>
          <View style={[styles.toolColumn, { top: frame.top + sz(8), right: frame.left + sz(8) }]} pointerEvents={posting ? 'none' : 'box-none'}>
            <ToolButton icon={<Text style={styles.aa}>Aa</Text>} label="Text" onPress={() => startText()} />
            <ToolButton
              icon={<MaterialCommunityIcons name="sticker-emoji" size={sz(25)} color="#FFF" />}
              label="Stickers"
              onPress={() => setSheet('stickers')}
            />
            <ToolButton
              icon={<Ionicons name="musical-notes" size={sz(23)} color="#FFF" />}
              label="Music"
              onPress={() => (layout.music ? setMode('music') : setSheet('music'))}
            />
            {photo && (
              <ToolButton
                icon={<Ionicons name="color-filter-outline" size={sz(24)} color="#FFF" />}
                label="Filters"
                onPress={() => setMode('filters')}
              />
            )}
            <ToolButton
              icon={<MaterialCommunityIcons name="draw" size={sz(25)} color="#FFF" />}
              label="Draw"
              onPress={() => setMode('draw')}
            />
            <ToolButton
              icon={<MaterialCommunityIcons name="format-color-fill" size={sz(24)} color="#FFF" />}
              label="Background"
              onPress={cycleBackground}
            />
            {isVideo && !layout.music && (
              <ToolButton
                icon={<Ionicons name={layout.videoMuted ? 'volume-mute' : 'volume-high'} size={sz(23)} color="#FFF" />}
                label={layout.videoMuted ? 'Turn sound on' : 'Mute video'}
                onPress={() => setLayout((l) => ({ ...l, videoMuted: !l.videoMuted }))}
              />
            )}
            {canSave && (
              <ToolButton
                icon={saving ? <ActivityIndicator color="#FFF" /> : <Ionicons name="download-outline" size={sz(24)} color="#FFF" />}
                label="Save to camera roll"
                onPress={save}
                disabled={saving}
              />
            )}
          </View>
        </>
      )}

      {/* ── Draw tools ── */}
      {mode === 'draw' && !live && (
        <>
          <View style={[styles.topBar, { top: frame.top + sz(8) }]} pointerEvents="box-none">
            <ToolButton
              icon={<Ionicons name="arrow-undo" size={sz(24)} color={history.length ? '#FFF' : 'rgba(255,255,255,0.35)'} />}
              label="Undo"
              onPress={undoDraw}
              disabled={!history.length}
            />
            <View style={styles.brushRow}>
              {BRUSH_ORDER.map((b) => (
                <BrushButton key={b} icon={BRUSHES[b].icon} label={BRUSHES[b].label} selected={brush === b} onPress={() => setBrush(b)} />
              ))}
              <BrushButton icon="eraser" label="Eraser" selected={brush === 'eraser'} onPress={() => setBrush('eraser')} />
            </View>
            <Pressable style={styles.doneBtn} onPress={() => setMode('idle')} accessibilityRole="button">
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
          <View style={[styles.sideSlider, { top: frame.top + frame.height / 2 - sz(110) }]}>
            <VerticalSlider value={drawSize} onChange={setDrawSize} />
          </View>
          {brush !== 'eraser' && (
            <View style={[styles.canvasBottomRow, { top: frame.top + frame.height - sz(60) }]}>
              <PaletteRow value={drawColor} onChange={setDrawColor} />
            </View>
          )}
        </>
      )}

      {/* ── Filters ── */}
      {mode === 'filters' && photo && mediaUri && (
        <>
          <View style={[styles.topBar, { top: frame.top + sz(8) }]} pointerEvents="box-none">
            <View style={styles.flex} />
            <Pressable style={styles.doneBtn} onPress={() => setMode('idle')} accessibilityRole="button">
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
          <View style={[styles.canvasBottomRow, { top: frame.top + frame.height - sz(112) }]}>
            <FlatList
              horizontal
              data={FILTER_ORDER}
              keyExtractor={(f) => f}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
              renderItem={({ item: f }) => {
                const selected = photo.filter === f;
                if (isVideo) {
                  // One video player per thumbnail would be too heavy; names only.
                  return (
                    <Pressable
                      onPress={() => setFilter(f)}
                      style={[styles.filterChip, selected && styles.filterChipSelected]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.filterChipText, selected && { color: '#111' }]}>{FILTERS[f].label}</Text>
                    </Pressable>
                  );
                }
                return (
                  <Pressable onPress={() => setFilter(f)} style={styles.filterItem} accessibilityRole="button" accessibilityState={{ selected }}>
                    <View style={[styles.filterThumb, selected && styles.filterThumbSelected]}>
                      <PhotoContent uri={mediaUri} photo={{ ...photo, filter: f }} fit="cover" />
                    </View>
                    <Text style={[styles.filterLabel, selected && styles.filterLabelSelected]}>{FILTERS[f].label}</Text>
                  </Pressable>
                );
              }}
            />
          </View>
        </>
      )}

      {/* ── Music: which 15 seconds play ── */}
      {mode === 'music' && layout.music && (
        <View style={[styles.musicPanel, { top: frame.top + frame.height - sz(150), left: frame.left + sz(12), right: frame.left + sz(12) }]}>
          <View style={styles.musicHeader}>
            <Ionicons name="musical-notes" size={sz(16)} color="#FF6B2B" />
            <Text style={styles.musicName} numberOfLines={1}>
              {layout.music.title} · <Text style={styles.musicArtistName}>{layout.music.artist}</Text>
            </Text>
          </View>
          <ClipSlider
            value={layout.music.start / MAX_CLIP_START}
            windowFraction={MUSIC_CLIP_SECONDS / 30}
            onChange={(v) => setClipStart(Math.round(v * MAX_CLIP_START * 10) / 10)}
          />
          <View style={styles.musicActions}>
            <Pressable onPress={removeMusic} hitSlop={sz(8)} accessibilityRole="button">
              <Text style={styles.musicRemove}>Remove</Text>
            </Pressable>
            <Pressable onPress={() => setSheet('music')} hitSlop={sz(8)} accessibilityRole="button">
              <Text style={styles.musicChange}>Change song</Text>
            </Pressable>
            <Pressable onPress={() => setMode('idle')} hitSlop={sz(8)} accessibilityRole="button">
              <Text style={styles.musicDone}>Done</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ── Share ── */}
      {showChrome && mode === 'idle' && (
        <View style={[styles.bottomBar, { top: frame.top + frame.height, paddingBottom: insets.bottom }]}>
          <Pressable
            style={({ pressed }) => [styles.cfBtn, (isEmpty || !!posting) && styles.shareBtnDisabled, pressed && styles.pressed]}
            // With nobody on the list yet, picking them comes first.
            onPress={() => (closeFriends ? post('close_friends') : setSheet('closeFriendsShare'))}
            onLongPress={() => setSheet('closeFriends')}
            disabled={isEmpty || !!posting}
            accessibilityRole="button"
            accessibilityLabel="Share to Close Friends"
            accessibilityHint="Long press to edit your Close Friends list"
          >
            {posting === 'close_friends' ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <View style={styles.cfStar}>
                  <Ionicons name="star" size={sz(13)} color="#FFF" />
                </View>
                <Text style={styles.cfText}>Close Friends</Text>
              </>
            )}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.shareBtn, (isEmpty || !!posting) && styles.shareBtnDisabled, pressed && styles.pressed]}
            onPress={() => post('all')}
            disabled={isEmpty || !!posting}
            accessibilityRole="button"
            accessibilityLabel="Share to your story"
          >
            {posting === 'all' ? (
              <ActivityIndicator color="#111" />
            ) : (
              <>
                <Text style={styles.shareText}>Your story</Text>
                <View style={styles.shareArrow}>
                  <Ionicons name="arrow-forward" size={sz(18)} color="#FFF" />
                </View>
              </>
            )}
          </Pressable>
        </View>
      )}

      {editing && (
        <TextComposer
          layer={editing.layer}
          k={k}
          onChange={(layer) => setEditing((e) => (e ? { ...e, layer } : e))}
          onDone={finishText}
        />
      )}

      <StickerSheet
        visible={stickersOpen}
        onClose={() => setStickersOpen(false)}
        onEmoji={(e) => addSticker('emoji', e)}
        onTime={() => addSticker('time', clockNow())}
        onDate={() => addSticker('date', dateNow())}
        onTextSticker={(prefix) => {
          setStickersOpen(false);
          startText(prefix, true);
        }}
        onMention={() => setSheet('mention')}
        onMusic={() => setSheet('music')}
      />
      <MusicSheet visible={sheet === 'music'} onClose={() => setSheet(null)} onPick={pickTrack} />
      <MentionSheet visible={sheet === 'mention'} onClose={() => setSheet(null)} onPick={addMention} />
      <CloseFriendsSheet
        visible={sheet === 'closeFriends' || sheet === 'closeFriendsShare'}
        shareLabel={sheet === 'closeFriendsShare' ? 'Share to Close Friends' : undefined}
        onClose={() => setSheet(null)}
        onSaved={(ids) => {
          const share = sheet === 'closeFriendsShare';
          setSheet(null);
          setCloseFriendsCount(ids.length);
          if (share && ids.length) post('close_friends');
        }}
      />
    </View>
  );
}

function ToolButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.toolBtn, pressed && styles.pressed]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={sz(4)}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon}
    </Pressable>
  );
}

function BrushButton({
  icon,
  label,
  selected,
  onPress,
}: {
  icon: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.brushBtn, selected && styles.brushBtnSelected]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
    >
      <MaterialCommunityIcons name={icon as any} size={sz(20)} color={selected ? '#111' : '#FFF'} />
    </Pressable>
  );
}

const shadow = {
  textShadowColor: 'rgba(0,0,0,0.45)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: sz(3),
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000',
  },
  flex: {
    flex: 1,
  },
  canvas: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: sz(12),
    backgroundColor: '#111',
  },
  placeholder: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: sz(30),
    fontWeight: '600',
    ...shadow,
  },
  guideV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#3897F0',
  },
  guideH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#3897F0',
  },
  toast: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastText: {
    color: '#FFF',
    fontSize: sz(28),
    fontWeight: '700',
    ...shadow,
  },
  trash: {
    position: 'absolute',
    width: sz(56),
    height: sz(56),
    borderRadius: sz(28),
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
  },
  toolColumn: {
    position: 'absolute',
    gap: sz(10),
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: sz(14),
    height: sz(34),
    borderRadius: sz(17),
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignSelf: 'center',
  },
  filterChipSelected: {
    backgroundColor: '#FFF',
  },
  filterChipText: {
    color: '#FFF',
    fontSize: sz(13),
    fontWeight: '600',
  },
  musicPanel: {
    position: 'absolute',
    padding: sz(14),
    borderRadius: sz(16),
    backgroundColor: 'rgba(20,20,20,0.88)',
    gap: sz(12),
  },
  musicHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(8),
  },
  musicName: {
    flex: 1,
    color: '#FFF',
    fontSize: sz(14),
    fontWeight: '700',
  },
  musicArtistName: {
    color: 'rgba(255,255,255,0.65)',
    fontWeight: '500',
  },
  musicActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  musicRemove: {
    color: '#ED4956',
    fontSize: sz(14),
    fontWeight: '600',
  },
  musicChange: {
    color: '#FFF',
    fontSize: sz(14),
    fontWeight: '600',
  },
  musicDone: {
    color: '#FF6B2B',
    fontSize: sz(15),
    fontWeight: '700',
  },
  cfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(8),
    height: sz(46),
    paddingHorizontal: sz(14),
    borderRadius: sz(23),
    backgroundColor: 'rgba(255,255,255,0.14)',
    minWidth: sz(140),
    justifyContent: 'center',
  },
  cfStar: {
    width: sz(24),
    height: sz(24),
    borderRadius: sz(12),
    backgroundColor: CLOSE_FRIENDS_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cfText: {
    color: '#FFF',
    fontSize: sz(15),
    fontWeight: '700',
  },
  topBar: {
    position: 'absolute',
    left: sz(8),
    right: sz(8),
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(2),
  },
  toolBtn: {
    width: sz(42),
    height: sz(42),
    borderRadius: sz(21),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  aa: {
    color: '#FFF',
    fontSize: sz(18),
    fontWeight: '700',
  },
  brushRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: sz(6),
  },
  brushBtn: {
    width: sz(36),
    height: sz(36),
    borderRadius: sz(18),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  brushBtnSelected: {
    backgroundColor: '#FFF',
  },
  doneBtn: {
    paddingHorizontal: sz(10),
    height: sz(42),
    justifyContent: 'center',
  },
  doneText: {
    color: '#FFF',
    fontSize: sz(17),
    fontWeight: '700',
    ...shadow,
  },
  sideSlider: {
    position: 'absolute',
    left: sz(6),
  },
  canvasBottomRow: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  filterRow: {
    paddingHorizontal: sz(12),
    gap: sz(10),
  },
  filterItem: {
    alignItems: 'center',
    gap: sz(4),
  },
  filterThumb: {
    width: sz(56),
    height: sz(72),
    borderRadius: sz(8),
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  filterThumbSelected: {
    borderColor: '#FFF',
  },
  filterLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: sz(11),
    fontWeight: '600',
    ...shadow,
  },
  filterLabelSelected: {
    color: '#FFF',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: sz(10),
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: sz(14),
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(10),
    height: sz(46),
    minWidth: sz(150),
    justifyContent: 'center',
    paddingLeft: sz(18),
    paddingRight: sz(6),
    borderRadius: sz(23),
    backgroundColor: '#FFF',
  },
  shareBtnDisabled: {
    opacity: 0.5,
  },
  shareText: {
    color: '#111',
    fontSize: sz(15),
    fontWeight: '700',
  },
  shareArrow: {
    width: sz(34),
    height: sz(34),
    borderRadius: sz(17),
    backgroundColor: '#FF6B2B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
