import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { ChatMessage } from '@/api/types';
import { sz } from '@/theme/scale';
import { describeMessage } from './format';
import { SINGLE_ROW_ON_WEB, useAutoGrowInput } from './useAutoGrowInput';

const ACCENT = '#FF6B2B';
const MAX_MESSAGE_LENGTH = 2000; // matches backend/src/services/chat.js
const webNoOutline = Platform.select({ web: { outlineStyle: 'none' } as any, default: undefined });

// One line of text fills the box to exactly the height of the round buttons
// beside it, so empty, the whole row lines up; as it grows, the buttons stay
// at the bottom.
const ROW_HEIGHT = sz(44);
const LINE_HEIGHT = sz(20);
const INPUT_MAX_HEIGHT = sz(120);
const BORDER = StyleSheet.hairlineWidth;
const INPUT_PADDING_V = Platform.select({
  // Exact on web, where the line height is set.
  web: (ROW_HEIGHT - LINE_HEIGHT) / 2 - BORDER,
  ios: sz(12),
  default: sz(9),
});

// Unsent text per conversation, kept while the app runs, as WhatsApp does.
const drafts = new Map<string, string>();

function Banner({ icon, title, message, onClose, closeLabel }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  message: ChatMessage;
  onClose: () => void;
  closeLabel: string;
}) {
  const thumb = message.kind === 'image' ? message.attachment?.local_uri || message.attachment?.url : null;
  const text = message.deleted_at
    ? 'This message was deleted'
    : describeMessage(message.kind, message.content, { name: message.attachment?.name, duration_ms: message.attachment?.duration_ms });
  return (
    <View style={styles.banner}>
      <View style={styles.bannerBar} />
      <View style={styles.bannerBody}>
        <View style={styles.bannerTitleRow}>
          <Ionicons name={icon} size={sz(13)} color="#FF8A55" />
          <Text style={styles.bannerTitle} numberOfLines={1}>{title}</Text>
        </View>
        <Text style={styles.bannerText} numberOfLines={1}>{text}</Text>
      </View>
      {thumb && <Image source={{ uri: thumb }} style={styles.bannerThumb} contentFit="cover" />}
      <Pressable onPress={onClose} hitSlop={10} style={styles.bannerClose} accessibilityRole="button" accessibilityLabel={closeLabel}>
        <Ionicons name="close" size={sz(18)} color="#BDBDBD" />
      </Pressable>
    </View>
  );
}

interface Props {
  matchId: string;
  chatName: string;
  myId?: string;
  replyTo: ChatMessage | null;
  editing: ChatMessage | null;
  canAttach: boolean;
  canRecord: boolean;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onSubmit: (text: string) => void;
  onAttach: () => void;
  onCamera: () => void;
  onRecord: () => void;
  onTyping: (active: boolean) => void;
}

export function Composer({
  matchId, chatName, myId, replyTo, editing, canAttach, canRecord,
  onCancelReply, onCancelEdit, onSubmit, onAttach, onCamera, onRecord, onTyping,
}: Props) {
  const [text, setText] = useState(() => drafts.get(matchId) ?? '');
  const inputRef = useRef<TextInput>(null);
  const draftBeforeEdit = useRef('');
  useAutoGrowInput(inputRef, text, INPUT_MAX_HEIGHT);

  // Editing puts the message in the box; leaving edit mode brings the draft back.
  useEffect(() => {
    if (editing) {
      draftBeforeEdit.current = text;
      setText(editing.content);
      inputRef.current?.focus();
    } else {
      setText(draftBeforeEdit.current || drafts.get(matchId) || '');
      draftBeforeEdit.current = '';
    }
    // Only when edit mode starts or ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo?.id]);

  const change = (value: string) => {
    setText(value);
    if (!editing) drafts.set(matchId, value);
    onTyping(value.length > 0);
  };

  const trimmed = text.trim();
  const editingMedia = !!editing && (editing.kind ?? 'text') !== 'text';
  const canSend = editing ? (editingMedia || trimmed.length > 0) && trimmed !== editing.content.trim() : trimmed.length > 0;

  const submit = () => {
    if (!canSend) return;
    onSubmit(trimmed);
    setText('');
    if (!editing) drafts.delete(matchId);
    onTyping(false);
  };

  const showMic = !editing && !trimmed && canRecord;

  return (
    <View style={styles.wrap}>
      {editing ? (
        <Banner icon="create-outline" title="Edit message" message={editing} onClose={onCancelEdit} closeLabel="Cancel editing" />
      ) : replyTo ? (
        <Banner
          icon="arrow-undo"
          title={replyTo.sender_id === myId ? 'Replying to yourself' : `Replying to ${chatName}`}
          message={replyTo}
          onClose={onCancelReply}
          closeLabel="Cancel reply"
        />
      ) : null}

      <View style={styles.row}>
        {canAttach && !editing && (
          <Pressable onPress={onAttach} hitSlop={6} style={styles.sideButton} accessibilityRole="button" accessibilityLabel="Attach a photo, video or document">
            <Ionicons name="add" size={sz(28)} color="#FFF" />
          </Pressable>
        )}

        <View style={styles.inputBox}>
          <TextInput
            ref={inputRef}
            {...SINGLE_ROW_ON_WEB}
            style={[styles.textInput, webNoOutline]}
            placeholder={editing ? 'Edit message' : `Message ${chatName}`}
            placeholderTextColor="#8A8A8A"
            value={text}
            onChangeText={change}
            onBlur={() => onTyping(false)}
            multiline
            maxLength={MAX_MESSAGE_LENGTH}
            accessibilityLabel="Message"
            // Web: Enter sends, Shift+Enter adds a new line.
            onKeyPress={(e: any) => {
              if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                e.preventDefault?.();
                submit();
              }
            }}
          />
          {canAttach && !editing && !trimmed && (
            <Pressable onPress={onCamera} hitSlop={8} style={styles.cameraButton} accessibilityRole="button" accessibilityLabel="Camera">
              <Ionicons name="camera-outline" size={sz(22)} color="#BDBDBD" />
            </Pressable>
          )}
        </View>

        {showMic ? (
          <Pressable
            onPress={onRecord}
            style={({ pressed }) => [styles.sendButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Record a voice message"
          >
            <Ionicons name="mic" size={sz(22)} color="#FFF" />
          </Pressable>
        ) : (
          <Pressable
            onPress={submit}
            disabled={!canSend}
            style={({ pressed }) => [styles.sendButton, !canSend && styles.sendDisabled, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Save edit' : 'Send message'}
          >
            <Ionicons name={editing ? 'checkmark' : 'arrow-up'} size={sz(22)} color={canSend ? '#FFF' : '#777'} />
          </Pressable>
        )}
      </View>
      {text.length > MAX_MESSAGE_LENGTH - 200 && (
        <Text style={styles.counter}>{text.length}/{MAX_MESSAGE_LENGTH}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#121212',
    paddingTop: sz(8),
    paddingBottom: sz(10),
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: sz(8), paddingHorizontal: sz(10) },
  sideButton: { width: sz(40), height: ROW_HEIGHT, justifyContent: 'center', alignItems: 'center' },
  inputBox: {
    flex: 1,
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#1E1E1E',
    borderRadius: ROW_HEIGHT / 2,
    borderWidth: BORDER,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingLeft: sz(16),
    paddingRight: sz(6),
  },
  textInput: {
    flex: 1,
    fontSize: sz(16),
    color: '#FFF',
    maxHeight: INPUT_MAX_HEIGHT,
    paddingTop: INPUT_PADDING_V,
    paddingBottom: INPUT_PADDING_V,
    paddingHorizontal: 0,
    // A set line height keeps the one-line box exact on web. iOS draws a
    // multiline input's text too low with one, so it keeps its own.
    ...(Platform.OS === 'web' ? { lineHeight: LINE_HEIGHT } : null),
  },
  // Inside the bordered box: its height minus the border, so on one line it
  // is centred and, as the text grows, it stays by the last line.
  cameraButton: { width: sz(36), height: ROW_HEIGHT - 2 * BORDER, justifyContent: 'center', alignItems: 'center' },
  sendButton: {
    width: ROW_HEIGHT, height: ROW_HEIGHT, borderRadius: ROW_HEIGHT / 2, backgroundColor: ACCENT,
    justifyContent: 'center', alignItems: 'center',
  },
  sendDisabled: { backgroundColor: '#262626' },
  pressed: { transform: [{ scale: 0.92 }] },
  counter: { color: '#8A8A8A', fontSize: sz(11), textAlign: 'right', paddingHorizontal: sz(16), paddingTop: sz(4) },
  banner: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: sz(12), marginBottom: sz(8),
    backgroundColor: '#1C1C1C', borderRadius: sz(12), overflow: 'hidden',
  },
  bannerBar: { width: sz(4), alignSelf: 'stretch', backgroundColor: '#FF8A55' },
  bannerBody: { flex: 1, paddingHorizontal: sz(10), paddingVertical: sz(8) },
  bannerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: sz(5) },
  bannerTitle: { color: '#FF8A55', fontSize: sz(13), fontWeight: '700', flexShrink: 1 },
  bannerText: { color: '#BDBDBD', fontSize: sz(13), marginTop: 2 },
  bannerThumb: { width: sz(40), height: sz(40), borderRadius: sz(6), marginRight: sz(4) },
  bannerClose: { width: sz(36), height: sz(40), justifyContent: 'center', alignItems: 'center' },
});
