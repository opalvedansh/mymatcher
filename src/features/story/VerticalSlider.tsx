import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { sz } from '@/theme/scale';

const TRACK = sz(220);
const THUMB = sz(22);

/** The size slider on the left edge of the text and draw tools; top is biggest. */
export function VerticalSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const set = (y: number) => onChange(Math.min(1, Math.max(0, 1 - y / TRACK)));
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      setDragging(true);
      set(e.y);
    })
    .onUpdate((e) => set(e.y))
    .onFinalize(() => setDragging(false));

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.hit} accessibilityRole="adjustable" accessibilityLabel="Size">
        {/* Wedge: wide at the top (big) and narrow at the bottom (small). */}
        <View style={styles.wedge} />
        <View
          style={[
            styles.thumb,
            dragging && styles.thumbActive,
            { top: (1 - value) * TRACK - THUMB / 2 },
          ]}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: sz(44),
    height: TRACK,
    alignItems: 'center',
  },
  wedge: {
    width: 0,
    height: TRACK,
    borderLeftWidth: sz(7),
    borderRightWidth: sz(7),
    borderTopWidth: TRACK,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(255,255,255,0.45)',
    borderBottomWidth: 0,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: sz(3),
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  thumbActive: {
    transform: [{ scale: 1.2 }],
  },
});
