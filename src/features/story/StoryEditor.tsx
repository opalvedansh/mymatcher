import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Directions, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { uploadImage, uploadStory } from '@/api';
import { showAlert } from '@/components/ActionSheet';
import { tapFeedback } from '@/utils/optionalModules';
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
} from './layout';
import { LayerContent, PhotoContent, StoryBackgroundView, StrokesView } from './StoryCanvas';
import { Transformable, type DragInfo } from './Transformable';
import { TextComposer } from './TextComposer';
import { StickerSheet, clockNow, dateNow } from './StickerSheet';
import { PaletteRow } from './PaletteRow';
import { VerticalSlider } from './VerticalSlider';

/** A photo to edit, or null for a text-only story on a coloured background. */
export type StoryDraft = { uri: string; width: number; height: number; fit: 'contain' | 'cover' } | null;

type Mode = 'idle' | 'draw' | 'filters';
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

  const [layout, setLayout] = useState<StoryLayout>(() => ({
    v: 1,
    bg: draft ? { kind: 'blur' } : { kind: 'gradient', colors: GRADIENTS[0] },
    photo: draft ? fitPhoto(draft.width, draft.height, draft.fit) : null,
    strokes: [],
    layers: [],
  }));
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const [mode, setMode] = useState<Mode>('idle');
  // A text-only story starts with the keyboard up, like Create mode.
  const [editing, setEditing] = useState<{ layer: TextLayer; isNew: boolean } | null>(() =>
    draft ? null : { layer: { ...DEFAULT_TEXT, id: newId(), text: '' }, isNew: true },
  );
  const [stickersOpen, setStickersOpen] = useState(false);
  const [dragging, setDragging] = useState<'layer' | 'photo' | null>(null);
  const [posting, setPosting] = useState(false);

  // The text style used last, so the next text starts from it.
  const lastText = useRef(DEFAULT_TEXT);

  // ─── Layers ────────────────────────────────────────────────────

  const updateLayer = useCallback((id: string, patch: Partial<Layer>) => {
    setLayout((l) => ({ ...l, layers: l.layers.map((x) => (x.id === id ? ({ ...x, ...patch } as Layer) : x)) }));
  }, []);

  const removeLayer = useCallback((id: string) => {
    tapFeedback();
    setLayout((l) => ({ ...l, layers: l.layers.filter((x) => x.id !== id) }));
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

  const [filterToast, setFilterToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const setFilter = useCallback((f: FilterId) => {
    setLayout((l) => (l.photo ? { ...l, photo: { ...l.photo, filter: f } } : l));
    setFilterToast(FILTERS[f].label);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setFilterToast(null), 900);
  }, []);

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
      const options = [...(l.photo ? [{ kind: 'blur' as const }] : []), ...GRADIENTS.map((c) => ({ kind: 'gradient' as const, colors: c }))];
      const i = options.findIndex((o) =>
        o.kind === l.bg.kind && (o.kind === 'blur' || (l.bg.kind === 'gradient' && o.colors[0] === l.bg.colors[0])),
      );
      return { ...l, bg: options[(i + 1) % options.length] };
    });
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
      else if (stickersOpen) setStickersOpen(false);
      else if (mode !== 'idle') setMode('idle');
      else close();
      return true;
    });
    return () => sub.remove();
  }, [editing, stickersOpen, mode, posting, close]);

  const post = async () => {
    if (posting || isEmpty) return;
    setPosting(true);
    try {
      const mediaUrl = draft ? await uploadImage(draft.uri) : null;
      await uploadStory(mediaUrl, compact(layoutRef.current));
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

  const canvasStyle = { top: frame.top, left: frame.left, width: frame.width, height: frame.height };

  return (
    <View style={styles.screen}>
      <View style={[styles.canvas, canvasStyle]}>
        {/* Tapping the background starts text, like tapping a story in the camera. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => idle && startText()}
          disabled={!idle}
          accessibilityLabel="Add text"
        >
          <StoryBackgroundView bg={layout.bg} mediaUri={mediaUri} />
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
              <PhotoContent uri={mediaUri} photo={photo} />
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
              onTap={layer.type === 'text' ? () => editText(layer) : undefined}
              onDragStart={onLayerDragStart}
              onDragEnd={onDragEnd}
              onDelete={() => removeLayer(layer.id)}
            >
              <LayerContent layer={layer} k={k} />
            </Transformable>
          ),
        )}

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

        {filterToast && (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{filterToast}</Text>
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

      {/* ── Top toolbar ── */}
      {showChrome && mode === 'idle' && (
        <View style={[styles.topBar, { top: frame.top + sz(8) }]} pointerEvents={posting ? 'none' : 'box-none'}>
          <ToolButton icon={<Ionicons name="close" size={sz(30)} color="#FFF" />} label="Close" onPress={close} />
          <View style={styles.flex} />
          <ToolButton
            icon={<MaterialCommunityIcons name="format-color-fill" size={sz(25)} color="#FFF" />}
            label="Background"
            onPress={cycleBackground}
          />
          {photo && (
            <ToolButton
              icon={<Ionicons name="color-filter-outline" size={sz(25)} color="#FFF" />}
              label="Filters"
              onPress={() => setMode('filters')}
            />
          )}
          <ToolButton
            icon={<MaterialCommunityIcons name="sticker-emoji" size={sz(26)} color="#FFF" />}
            label="Stickers"
            onPress={() => setStickersOpen(true)}
          />
          <ToolButton
            icon={<MaterialCommunityIcons name="draw" size={sz(26)} color="#FFF" />}
            label="Draw"
            onPress={() => setMode('draw')}
          />
          <ToolButton icon={<Text style={styles.aa}>Aa</Text>} label="Text" onPress={() => startText()} />
        </View>
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

      {/* ── Share ── */}
      {showChrome && mode === 'idle' && (
        <View style={[styles.bottomBar, { top: frame.top + frame.height, paddingBottom: insets.bottom }]}>
          <Pressable
            style={({ pressed }) => [styles.shareBtn, (isEmpty || posting) && styles.shareBtnDisabled, pressed && styles.pressed]}
            onPress={post}
            disabled={isEmpty || posting}
            accessibilityRole="button"
            accessibilityLabel="Share to your story"
          >
            {posting ? (
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
    justifyContent: 'flex-end',
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
