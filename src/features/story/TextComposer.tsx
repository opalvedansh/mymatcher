import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FONT_ORDER, FONTS, type TextAlign, type TextBg, type TextLayer } from './layout';
import { textLayerStyles } from './StoryCanvas';
import { PaletteRow } from './PaletteRow';
import { VerticalSlider } from './VerticalSlider';
import { sz } from '@/theme/scale';

const MIN_SIZE = 36;
const MAX_SIZE = 200;
const NEXT_ALIGN: Record<TextAlign, TextAlign> = { center: 'left', left: 'right', right: 'center' };
const NEXT_BG: Record<TextBg, TextBg> = { none: 'solid', solid: 'soft', soft: 'none' };

/**
 * Typing over the story: the text is shown as it will look, with the font
 * styles, colours, background modes, alignment and size around it. Tapping
 * outside the text, or Done, puts it on the canvas.
 */
export function TextComposer({
  layer,
  k,
  onChange,
  onDone,
}: {
  layer: TextLayer;
  k: number;
  onChange: (l: TextLayer) => void;
  onDone: () => void;
}) {
  const [showColors, setShowColors] = useState(false);
  const set = (patch: Partial<TextLayer>) => onChange({ ...layer, ...patch });
  const { box, text } = textLayerStyles(layer, k);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={[StyleSheet.absoluteFill, styles.dim]} onPress={onDone} accessibilityLabel="Done editing text" />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
      >
        <SafeAreaView style={styles.fill} edges={['top']} pointerEvents="box-none">
          <View style={styles.topBar}>
            <Pressable
              style={styles.topBtn}
              onPress={() => set({ align: NEXT_ALIGN[layer.align] })}
              accessibilityLabel={`Align ${NEXT_ALIGN[layer.align]}`}
            >
              <MaterialCommunityIcons name={`format-align-${layer.align}`} size={sz(26)} color="#FFF" />
            </Pressable>
            <Pressable
              style={styles.topBtn}
              onPress={() => setShowColors((v) => !v)}
              accessibilityLabel={showColors ? 'Show fonts' : 'Show colours'}
            >
              {showColors ? (
                <Text style={styles.fontToggle}>Aa</Text>
              ) : (
                <LinearGradient
                  colors={['#FDCB5C', '#ED4956', '#A307BA', '#3897F0', '#70C050']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.colorWheel}
                />
              )}
            </Pressable>
            <Pressable
              style={styles.topBtn}
              onPress={() => set({ bg: NEXT_BG[layer.bg] })}
              accessibilityLabel="Text background"
            >
              <View
                style={[
                  styles.bgIcon,
                  layer.bg === 'solid' && styles.bgIconSolid,
                  layer.bg === 'soft' && styles.bgIconSoft,
                ]}
              >
                <Text style={[styles.bgIconText, layer.bg === 'solid' && { color: '#000' }]}>A</Text>
              </View>
            </Pressable>
            <View style={styles.fill} />
            <Pressable style={styles.doneBtn} onPress={onDone} accessibilityRole="button">
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>

          <View style={styles.inputArea} pointerEvents="box-none">
            <View style={styles.slider}>
              <VerticalSlider
                value={(layer.size - MIN_SIZE) / (MAX_SIZE - MIN_SIZE)}
                onChange={(v) => set({ size: Math.round(MIN_SIZE + v * (MAX_SIZE - MIN_SIZE)) })}
              />
            </View>
            <View style={[box, styles.inputBox]}>
              <TextInput
                value={layer.text}
                onChangeText={(t) => set({ text: t })}
                autoFocus
                multiline
                scrollEnabled={false}
                placeholder="Type something…"
                placeholderTextColor="rgba(255,255,255,0.55)"
                selectionColor={layer.color === '#FFFFFF' ? '#FF6B2B' : layer.color}
                style={[text, styles.input]}
                maxLength={500}
              />
            </View>
          </View>

          <View style={styles.bottom}>
            {showColors ? (
              <PaletteRow value={layer.color} onChange={(c) => set({ color: c })} />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="always"
                contentContainerStyle={styles.fontRow}
              >
                {FONT_ORDER.map((id) => {
                  const f = FONTS[id];
                  const selected = layer.font === id;
                  return (
                    <Pressable
                      key={id}
                      onPress={() => set({ font: id })}
                      style={[styles.fontChip, selected && styles.fontChipSelected]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text
                        style={[
                          styles.fontChipText,
                          {
                            fontFamily: f.family,
                            fontWeight: f.weight,
                            fontStyle: f.italic ? 'italic' : 'normal',
                            textTransform: f.upper ? 'uppercase' : 'none',
                          },
                          selected && { color: '#000' },
                        ]}
                      >
                        {f.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  dim: {
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: sz(10),
    paddingTop: sz(6),
    gap: sz(6),
  },
  topBtn: {
    width: sz(44),
    height: sz(44),
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorWheel: {
    width: sz(26),
    height: sz(26),
    borderRadius: sz(13),
    borderWidth: 2,
    borderColor: '#FFF',
  },
  fontToggle: {
    color: '#FFF',
    fontSize: sz(19),
    fontWeight: '700',
  },
  bgIcon: {
    width: sz(26),
    height: sz(26),
    borderRadius: sz(6),
    borderWidth: 2,
    borderColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bgIconSolid: {
    backgroundColor: '#FFF',
  },
  bgIconSoft: {
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  bgIconText: {
    color: '#FFF',
    fontSize: sz(15),
    fontWeight: '800',
  },
  doneBtn: {
    paddingHorizontal: sz(12),
    height: sz(44),
    justifyContent: 'center',
  },
  doneText: {
    color: '#FFF',
    fontSize: sz(17),
    fontWeight: '700',
  },
  inputArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  slider: {
    position: 'absolute',
    left: sz(6),
    top: '50%',
    marginTop: -sz(110),
  },
  inputBox: {
    minWidth: sz(40),
  },
  input: {
    padding: 0,
    margin: 0,
    // The browser's focus ring, on web.
    outlineWidth: 0,
    textAlignVertical: 'center',
  },
  bottom: {
    paddingBottom: sz(8),
  },
  fontRow: {
    paddingHorizontal: sz(14),
    gap: sz(8),
    alignItems: 'center',
  },
  fontChip: {
    paddingHorizontal: sz(14),
    height: sz(34),
    borderRadius: sz(17),
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    justifyContent: 'center',
  },
  fontChipSelected: {
    backgroundColor: '#FFF',
    borderColor: '#FFF',
  },
  fontChipText: {
    color: '#FFF',
    fontSize: sz(14),
  },
});
