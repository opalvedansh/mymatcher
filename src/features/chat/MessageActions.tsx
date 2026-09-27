import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChatMessage } from '@/api/types';
import { sz } from '@/theme/scale';
import { Sheet, SheetAction, SheetGroup } from './Sheet';
import { describeMessage, formatClock } from './format';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥'];

// Same windows as the server (services/chat.js); it has the final say.
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const DELETE_FOR_EVERYONE_WINDOW_MS = 48 * 60 * 60 * 1000;

const age = (m: ChatMessage) => Date.now() - new Date(m.created_at).getTime();

export function canEdit(m: ChatMessage, myId?: string) {
  return m.sender_id === myId && !m.deleted_at && !m.id.startsWith('temp-')
    && (m.kind ?? 'text') !== 'audio' && age(m) < EDIT_WINDOW_MS;
}

export function canDeleteForEveryone(m: ChatMessage, myId?: string) {
  return m.sender_id === myId && !m.deleted_at && !m.id.startsWith('temp-') && age(m) < DELETE_FOR_EVERYONE_WINDOW_MS;
}

export interface MessageActionHandlers {
  onReact: (message: ChatMessage, emoji: string | null) => void;
  onReply: (message: ChatMessage) => void;
  onCopy?: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onForward: (message: ChatMessage) => void;
  onOpen: (message: ChatMessage) => void;
  onDeleteForMe: (message: ChatMessage) => void;
  onDeleteForEveryone: (message: ChatMessage) => void;
  onReport: (message: ChatMessage) => void;
  onDiscard: (message: ChatMessage) => void;
}

export function MessageActionsSheet({
  message,
  myId,
  onClose,
  handlers,
}: {
  message: ChatMessage | null;
  myId?: string;
  onClose: () => void;
  handlers: MessageActionHandlers;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setConfirmDelete(false), [message?.id]);

  if (!message) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;

  const isMe = message.sender_id === myId;
  const deleted = !!message.deleted_at;
  const pending = message.id.startsWith('temp-');
  const kind = message.kind ?? 'text';
  const myReaction = message.reactions?.find((r) => r.user_id === myId)?.emoji ?? null;
  const copyable = !deleted && !!message.content && !!handlers.onCopy;
  const hasFile = !deleted && kind !== 'text' && !!message.attachment?.url;
  const run = (fn: (m: ChatMessage) => void) => () => {
    onClose();
    fn(message);
  };

  const preview = deleted
    ? 'This message was deleted'
    : describeMessage(kind, message.content, { name: message.attachment?.name, duration_ms: message.attachment?.duration_ms });

  const actions: React.ReactNode[] = [];
  const push = (key: string, node: (first: boolean) => React.ReactNode) => actions.push(
    <React.Fragment key={key}>{node(actions.length === 0)}</React.Fragment>,
  );

  if (confirmDelete) {
    if (canDeleteForEveryone(message, myId)) {
      push('everyone', (first) => (
        <SheetAction first={first} icon="trash-outline" label="Delete for everyone" destructive onPress={run(handlers.onDeleteForEveryone)} />
      ));
    }
    push('me', (first) => (
      <SheetAction first={first} icon="eye-off-outline" label="Delete for me" destructive onPress={run(handlers.onDeleteForMe)} />
    ));
  } else if (pending) {
    if (copyable) push('copy', (first) => <SheetAction first={first} icon="copy-outline" label="Copy" onPress={run(handlers.onCopy!)} />);
    push('discard', (first) => (
      <SheetAction first={first} icon="close-circle-outline" label="Discard" destructive onPress={run(handlers.onDiscard)} />
    ));
  } else {
    if (!deleted) push('reply', (first) => <SheetAction first={first} icon="arrow-undo-outline" label="Reply" onPress={run(handlers.onReply)} />);
    if (copyable) push('copy', (first) => <SheetAction first={first} icon="copy-outline" label="Copy" onPress={run(handlers.onCopy!)} />);
    if (canEdit(message, myId)) push('edit', (first) => <SheetAction first={first} icon="create-outline" label="Edit" onPress={run(handlers.onEdit)} />);
    if (!deleted) push('forward', (first) => <SheetAction first={first} icon="arrow-redo-outline" label="Forward" onPress={run(handlers.onForward)} />);
    if (hasFile) {
      push('open', (first) => (
        <SheetAction
          first={first}
          icon={kind === 'document' ? 'open-outline' : 'download-outline'}
          label={kind === 'document' ? 'Open' : 'Save or share'}
          onPress={run(handlers.onOpen)}
        />
      ));
    }
    if (!isMe && !deleted) push('report', (first) => <SheetAction first={first} icon="flag-outline" label="Report" onPress={run(handlers.onReport)} />);
    push('delete', (first) => (
      <SheetAction first={first} icon="trash-outline" label="Delete" destructive onPress={() => setConfirmDelete(true)} />
    ));
  }

  return (
    <Sheet visible onClose={onClose}>
      {!deleted && !pending && !confirmDelete && (
        <View style={styles.reactions} accessibilityRole="menu" accessibilityLabel="React">
          {QUICK_REACTIONS.map((emoji) => {
            const selected = emoji === myReaction;
            return (
              <Pressable
                key={emoji}
                onPress={() => {
                  onClose();
                  handlers.onReact(message, selected ? null : emoji);
                }}
                style={({ pressed }) => [styles.reaction, selected && styles.reactionSelected, pressed && { transform: [{ scale: 1.15 }] }]}
                accessibilityRole="button"
                accessibilityLabel={selected ? `Remove ${emoji} reaction` : `React ${emoji}`}
              >
                <Text style={styles.reactionEmoji}>{emoji}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.preview}>
        <Text style={styles.previewText} numberOfLines={2}>
          {confirmDelete ? 'Delete this message?' : preview}
        </Text>
        {isMe && !pending && !deleted && !confirmDelete && (
          <Text style={styles.info}>
            {message.read_at
              ? `Read ${formatClock(message.read_at)}`
              : message.delivered_at
                ? `Delivered ${formatClock(message.delivered_at)}`
                : `Sent ${formatClock(message.created_at)}`}
          </Text>
        )}
      </View>

      <SheetGroup>{actions}</SheetGroup>

      <Pressable onPress={confirmDelete ? () => setConfirmDelete(false) : onClose} style={styles.cancel} accessibilityRole="button">
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  reactions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1C1C1C',
    borderRadius: sz(28),
    paddingHorizontal: sz(8),
    paddingVertical: sz(6),
  },
  reaction: { width: sz(42), height: sz(42), borderRadius: sz(21), justifyContent: 'center', alignItems: 'center' },
  reactionSelected: { backgroundColor: 'rgba(255,107,43,0.25)' },
  reactionEmoji: { fontSize: sz(26) },
  preview: { marginTop: sz(14), paddingHorizontal: sz(4) },
  previewText: { color: '#D0D0D0', fontSize: sz(14), lineHeight: sz(20) },
  info: { color: '#8A8A8A', fontSize: sz(12), marginTop: sz(4) },
  cancel: {
    marginTop: sz(10), minHeight: sz(52), borderRadius: sz(16), backgroundColor: '#1C1C1C',
    justifyContent: 'center', alignItems: 'center',
  },
  cancelText: { color: '#FFF', fontSize: sz(16), fontWeight: '600' },
});
