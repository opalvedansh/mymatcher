import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { sz } from '@/theme/scale';

const BARS = 48;

/**
 * Picks which part of a song plays: a window (`windowFraction` of the track)
 * dragged along a waveform-style strip. `value` is where the window starts, 0–1
 * of the room it can move in.
 */
export function ClipSlider({
  value,
  windowFraction,
  onChange,
}: {
  value: number;
  windowFraction: number;
  onChange: (v: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const startValue = useRef(value);
  const windowW = width * windowFraction;
  const room = Math.max(1, width - windowW);

  // Decorative bar heights, fixed per mount so they don't jump.
  const heights = useMemo(() => Array.from({ length: BARS }, (_, i) => 0.3 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))), []);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin(() => {
      startValue.current = value;
    })
    .onUpdate((e) => {
      onChange(Math.min(1, Math.max(0, startValue.current + e.translationX / room)));
    });

  const left = value * room;
  return (
    <GestureDetector gesture={pan}>
      <View
        style={styles.track}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        accessibilityRole="adjustable"
        accessibilityLabel="Part of the song that plays"
      >
        <View style={styles.bars} pointerEvents="none">
          {heights.map((h, i) => {
            const x = ((i + 0.5) / BARS) * width;
            const inside = x >= left && x <= left + windowW;
            return <View key={i} style={[styles.bar, { height: `${h * 100}%` }, inside && styles.barOn]} />;
          })}
        </View>
        <View pointerEvents="none" style={[styles.window, { left, width: windowW }]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  track: {
    height: sz(44),
    justifyContent: 'center',
  },
  bars: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: sz(6),
  },
  bar: {
    width: sz(3),
    borderRadius: sz(2),
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  barOn: {
    backgroundColor: '#FFF',
  },
  window: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: sz(10),
    borderWidth: 2,
    borderColor: '#FF6B2B',
  },
});
