import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { CANVAS_H, CANVAS_W, type CanvasFrame, type Placement } from './layout';

/** Within this many canvas units of the centre line, a layer snaps onto it. */
const SNAP = 18;

export type DragInfo = { overTrash: SharedValue<number>; guideX: SharedValue<number>; guideY: SharedValue<number> };

/**
 * Drag with one finger, pinch to zoom and twist to turn, all at once, like a
 * story sticker. The move runs on the UI thread and is written back once the
 * fingers lift. Centred on the layer's own centre, at canvas scale.
 */
export function Transformable({
  placement,
  frame,
  minScale,
  maxScale,
  enabled = true,
  snap = false,
  trash,
  drag,
  onCommit,
  onTap,
  onDragStart,
  onDragEnd,
  onDelete,
  children,
}: {
  placement: Placement;
  frame: CanvasFrame;
  minScale: number;
  maxScale: number;
  enabled?: boolean;
  /** Snap to the canvas centre lines (layers, not the photo). */
  snap?: boolean;
  /** The trash target's centre in window coordinates; dropping a layer there deletes it. */
  trash?: { x: number; y: number; radius: number };
  drag?: DragInfo;
  onCommit: (p: Placement) => void;
  onTap?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDelete?: () => void;
  children: React.ReactNode;
}) {
  const k = frame.k;
  const rawX = useSharedValue(placement.x);
  const rawY = useSharedValue(placement.y);
  const scale = useSharedValue(placement.scale);
  const rotation = useSharedValue(placement.rotation);
  const active = useSharedValue(0);

  // Follows changes made outside a gesture (undo, re-editing). During a
  // gesture the shared values lead and the props catch up on commit.
  useEffect(() => {
    if (active.value > 0) return;
    rawX.value = placement.x;
    rawY.value = placement.y;
    scale.value = placement.scale;
    rotation.value = placement.rotation;
  }, [placement.x, placement.y, placement.scale, placement.rotation, active, rawX, rawY, scale, rotation]);

  // Callbacks change every render (they close over the layer); the gesture
  // reaches them through a ref so it isn't rebuilt in the middle of a drag.
  const handlers = useRef({ onCommit, onTap, onDragStart, onDragEnd, onDelete });
  handlers.current = { onCommit, onTap, onDragStart, onDragEnd, onDelete };
  const fire = useCallback((event: 'commit' | 'tap' | 'dragStart' | 'dragEnd' | 'delete', p?: Placement) => {
    const h = handlers.current;
    if (event === 'commit' && p) h.onCommit(p);
    else if (event === 'tap') h.onTap?.();
    else if (event === 'dragStart') h.onDragStart?.();
    else if (event === 'dragEnd') h.onDragEnd?.();
    else if (event === 'delete') h.onDelete?.();
  }, []);
  const tappable = !!onTap;

  const gesture = useMemo(() => {
    const snapped = (v: number, centre: number) => {
      'worklet';
      return snap && Math.abs(v - centre) < SNAP ? centre : v;
    };
    const start = () => {
      'worklet';
      active.value += 1;
      if (active.value === 1) runOnJS(fire)('dragStart');
    };
    const end = () => {
      'worklet';
      active.value = Math.max(0, active.value - 1);
      if (active.value > 0) return;
      if (drag) {
        drag.guideX.value = 0;
        drag.guideY.value = 0;
      }
      const dropped = !!drag && drag.overTrash.value === 1;
      if (drag) drag.overTrash.value = 0;
      if (dropped) {
        runOnJS(fire)('delete');
      } else {
        const x = snapped(rawX.value, CANVAS_W / 2);
        const y = snapped(rawY.value, CANVAS_H / 2);
        rawX.value = x;
        rawY.value = y;
        runOnJS(fire)('commit', { x, y, scale: scale.value, rotation: rotation.value });
      }
      runOnJS(fire)('dragEnd');
    };

    const pan = Gesture.Pan()
      .enabled(enabled)
      .averageTouches(true)
      .onStart(start)
      .onChange((e) => {
        rawX.value += e.changeX / k;
        rawY.value += e.changeY / k;
        if (drag) {
          if (snap) {
            drag.guideX.value = Math.abs(rawX.value - CANVAS_W / 2) < SNAP ? 1 : 0;
            drag.guideY.value = Math.abs(rawY.value - CANVAS_H / 2) < SNAP ? 1 : 0;
          }
          if (trash) {
            const over = Math.hypot(e.absoluteX - trash.x, e.absoluteY - trash.y) < trash.radius;
            drag.overTrash.value = over ? 1 : 0;
          }
        }
      })
      .onEnd(end);
    const pinch = Gesture.Pinch()
      .enabled(enabled)
      .onStart(start)
      .onChange((e) => {
        scale.value = Math.min(maxScale, Math.max(minScale, scale.value * e.scaleChange));
      })
      .onEnd(end);
    const rotate = Gesture.Rotation()
      .enabled(enabled)
      .onStart(start)
      .onChange((e) => {
        rotation.value += e.rotationChange;
      })
      .onEnd(end);
    const transform = Gesture.Simultaneous(pan, pinch, rotate);
    if (!tappable) return transform;
    const tap = Gesture.Tap().enabled(enabled).maxDuration(400).onEnd((_e, ok) => {
      if (ok) runOnJS(fire)('tap');
    });
    return Gesture.Race(tap, transform);
  }, [enabled, snap, k, minScale, maxScale, trash, drag, tappable, fire, active, rawX, rawY, scale, rotation]);

  // A box much bigger than the content, centred on the layer's centre, so the
  // content sits in place without being measured and turns on its own centre.
  const half = frame.width * 1.5;
  const animated = useAnimatedStyle(() => {
    const x = snap && active.value > 0 && Math.abs(rawX.value - CANVAS_W / 2) < SNAP ? CANVAS_W / 2 : rawX.value;
    const y = snap && active.value > 0 && Math.abs(rawY.value - CANVAS_H / 2) < SNAP ? CANVAS_H / 2 : rawY.value;
    return {
      transform: [
        { translateX: x * k },
        { translateY: y * k },
        { rotate: `${rotation.value}rad` },
        { scale: scale.value },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        { position: 'absolute', left: -half, top: -half, width: half * 2, height: half * 2, alignItems: 'center', justifyContent: 'center' },
        animated,
      ]}
    >
      <GestureDetector gesture={gesture}>
        <Animated.View collapsable={false}>{children}</Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}
