import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { sz } from '@/theme/scale';
import type { LocalFile } from './upload';
import { formatDuration } from './format';
import { SINGLE_ROW_ON_WEB, useAutoGrowInput } from './useAutoGrowInput';

const ACCENT = '#FF6B2B';
const webNoOutline = Platform.select({ web: { outlineStyle: 'none' } as any, default: undefined });

// One caption line fills the box to the send button's height (see Composer).
const ROW_HEIGHT = sz(48);
const LINE_HEIGHT = sz(20);
const INPUT_MAX_HEIGHT = sz(120);
const INPUT_PADDING_V = Platform.select({
  web: (ROW_HEIGHT - LINE_HEIGHT) / 2,
  ios: sz(14),
  default: sz(11),
});

/**
 * The step between picking photos/videos and sending them: see what is about
 * to go out, drop any, add a caption.
 */
export function MediaPreview({
  files,
  chatName,
  onCancel,
  onSend,
}: {
  files: LocalFile[] | null;
  chatName: string;
  onCancel: () => void;
  onSend: (files: LocalFile[], caption: string) => void;
}) {
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<LocalFile[]>([]);
  const [index, setIndex] = useState(0);
  const [caption, setCaption] = useState('');
  const captionRef = useRef<TextInput>(null);
  useAutoGrowInput(captionRef, caption, INPUT_MAX_HEIGHT);

  useEffect(() => {
    setItems(files ?? []);
    setIndex(0);
    setCaption('');
  }, [files]);

  const current = items[Math.min(index, items.length - 1)];
  const remove = (i: number) => {
    const next = items.filter((_, j) => j !== i);
    if (!next.length) {
      onCancel();
      return;
    }
    setItems(next);
    setIndex(Math.min(index, next.length - 1));
  };

  return (
    <Modal visible={!!files?.length} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={onCancel} hitSlop={8} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Cancel">
            <Ionicons name="close" size={sz(26)} color="#FFF" />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{items.length > 1 ? `${index + 1} of ${items.length}` : 'Preview'}</Text>
          <Pressable
            onPress={() => remove(index)}
            hitSlop={8}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Remove this one"
          >
            <Ionicons name="trash-outline" size={sz(22)} color="#FFF" />
          </Pressable>
        </View>

        <View style={styles.stage}>
          {current && (current.kind === 'image' ? (
            <Image source={{ uri: current.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
          ) : (
            <View style={styles.videoStage}>
              <Ionicons name="videocam" size={sz(44)} color="#BDBDBD" />
              <Text style={styles.videoText}>Video · {formatDuration(current.duration_ms)}</Text>
            </View>
          ))}
        </View>

        {items.length > 1 && (
          <FlatList
            horizontal
            data={items}
            keyExtractor={(f, i) => `${f.uri}-${i}`}
            contentContainerStyle={styles.strip}
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, maxWidth: width }}
            renderItem={({ item, index: i }) => (
              <Pressable
                onPress={() => setIndex(i)}
                style={[styles.thumb, i === index && styles.thumbActive]}
                accessibilityRole="button"
                accessibilityLabel={`Item ${i + 1}`}
              >
                {item.kind === 'image' ? (
                  <Image source={{ uri: item.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Ionicons name="videocam" size={sz(18)} color="#BDBDBD" />
                )}
              </Pressable>
            )}
          />
        )}

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.composer}>
            <TextInput
              ref={captionRef}
              {...SINGLE_ROW_ON_WEB}
              value={caption}
              onChangeText={setCaption}
              placeholder="Add a caption…"
              placeholderTextColor="#8A8A8A"
              style={[styles.input, webNoOutline]}
              multiline
              maxLength={2000}
            />
            <Pressable
              onPress={() => onSend(items, caption.trim())}
              style={({ pressed }) => [styles.send, pressed && { transform: [{ scale: 0.92 }] }]}
              accessibilityRole="button"
              accessibilityLabel={`Send to ${chatName}`}
            >
              <Ionicons name="send" size={sz(20)} color="#FFF" />
            </Pressable>
          </View>
          <Text style={styles.to} numberOfLines={1}>To {chatName}{items.length > 1 ? ' · caption goes on the first one' : ''}</Text>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: sz(8), paddingVertical: sz(6) },
  iconButton: { width: sz(44), height: sz(44), borderRadius: sz(22), justifyContent: 'center', alignItems: 'center' },
  title: { flex: 1, color: '#FFF', fontSize: sz(16), fontWeight: '600', textAlign: 'center' },
  stage: { flex: 1 },
  videoStage: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: sz(10) },
  videoText: { color: '#BDBDBD', fontSize: sz(15) },
  strip: { paddingHorizontal: sz(12), paddingVertical: sz(10), gap: sz(8) },
  thumb: {
    width: sz(52), height: sz(52), borderRadius: sz(10), overflow: 'hidden', backgroundColor: '#1A1A1A',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'transparent',
  },
  thumbActive: { borderColor: ACCENT },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: sz(8), paddingHorizontal: sz(12), paddingTop: sz(8) },
  input: {
    flex: 1, minHeight: ROW_HEIGHT, maxHeight: INPUT_MAX_HEIGHT, color: '#FFF', fontSize: sz(16),
    backgroundColor: '#1E1E1E', borderRadius: ROW_HEIGHT / 2, paddingHorizontal: sz(16),
    paddingTop: INPUT_PADDING_V, paddingBottom: INPUT_PADDING_V,
    ...(Platform.OS === 'web' ? { lineHeight: LINE_HEIGHT } : null),
  },
  send: {
    width: ROW_HEIGHT, height: ROW_HEIGHT, borderRadius: ROW_HEIGHT / 2, backgroundColor: ACCENT,
    justifyContent: 'center', alignItems: 'center',
  },
  to: { color: '#8A8A8A', fontSize: sz(12), paddingHorizontal: sz(20), paddingTop: sz(6), paddingBottom: sz(8) },
});
