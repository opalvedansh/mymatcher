import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { PALETTE } from './layout';
import { sz } from '@/theme/scale';

/** The row of colour dots shared by the text and draw tools. */
export function PaletteRow({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      contentContainerStyle={styles.row}
    >
      {PALETTE.map((c) => {
        const selected = c.toLowerCase() === value.toLowerCase();
        return (
          <Pressable
            key={c}
            onPress={() => onChange(c)}
            hitSlop={sz(4)}
            accessibilityRole="button"
            accessibilityLabel={`Colour ${c}`}
            accessibilityState={{ selected }}
          >
            <View style={[styles.dot, { backgroundColor: c }, selected && styles.dotSelected]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: sz(14),
    gap: sz(12),
    alignItems: 'center',
    height: sz(44),
  },
  dot: {
    width: sz(26),
    height: sz(26),
    borderRadius: sz(13),
    borderWidth: 2,
    borderColor: '#FFF',
  },
  dotSelected: {
    width: sz(32),
    height: sz(32),
    borderRadius: sz(16),
    borderWidth: 3,
  },
});
