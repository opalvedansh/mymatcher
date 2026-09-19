import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { getMessages } from '@/api';
import { openSafetyMenu } from '@/components/safetyMenu';
import { socketService } from '@/api/socket';
import { useAuth } from '@/contexts/AuthContext';
import type { ChatMessage } from '@/api/types';
import { Avatar } from '@/components/ChatAvatar';
import { RateBrandSheet } from '@/components/RateBrandSheet';

const ACCENT = '#FF6B2B';
const MAX_MESSAGE_LENGTH = 2000; // matches backend/src/socket.js
const GROUP_GAP_MS = 5 * 60 * 1000;

const webNoOutline = Platform.select({ web: { outlineStyle: 'none' } as any, default: undefined });

interface Props {
  matchId: string;
  otherUserId: string;
  chatName: string;
  chatAvatar?: string;
  chatVerified?: boolean;
  matchedAt?: string;
  onBack: () => void;
}

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: ChatMessage; isMe: boolean; firstInGroup: boolean; lastInGroup: boolean };

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function dayLabel(date: Date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

function matchedLabel(iso: string) {
  const label = dayLabel(new Date(iso));
  return label === 'Today' || label === 'Yesterday' ? `Matched ${label.toLowerCase()}` : `Matched on ${label}`;
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Adds day separators and marks where runs of messages from one sender start and end.
function buildRows(messages: ChatMessage[], myId?: string): Row[] {
  const rows: Row[] = [];
  messages.forEach((message, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const at = new Date(message.created_at);
    if (!prev || !sameDay(new Date(prev.created_at), at)) {
      rows.push({ kind: 'day', key: `day-${message.created_at}`, label: dayLabel(at) });
    }
    const joinsPrev = !!prev && prev.sender_id === message.sender_id
      && sameDay(new Date(prev.created_at), at)
      && at.getTime() - new Date(prev.created_at).getTime() < GROUP_GAP_MS;
    const joinsNext = !!next && next.sender_id === message.sender_id
      && sameDay(new Date(next.created_at), at)
      && new Date(next.created_at).getTime() - at.getTime() < GROUP_GAP_MS;
    rows.push({
      kind: 'message',
      key: message.id,
      message,
      isMe: message.sender_id === myId,
      firstInGroup: !joinsPrev,
      lastInGroup: !joinsNext,
    });
  });
  return rows;
}

export function ConversationScreen({ matchId, otherUserId, chatName, chatAvatar, chatVerified, matchedAt, onBack }: Props) {
  const { user, onboardingData } = useAuth();
  // Only creators rate brands, and only the person they are talking to.
  const canRateThisChat = onboardingData?.role === 'Influencer';
  const [rateVisible, setRateVisible] = useState(false);

  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Client ids of messages the server has not confirmed.
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState(false);

  const flatListRef = useRef<FlatList<Row>>(null);
  const initialScrollDone = useRef(false);

  // 1. Fetch history
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(false);
        const res = await getMessages(matchId, 100);
        // The backend returns newest first; the list shows oldest at the top.
        if (!cancelled) setMessages([...res.data].reverse());
      } catch (e) {
        console.warn('Failed to load messages', e);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [matchId, reloadKey]);

  // 2. Live updates
  useEffect(() => {
    const setupSocket = async () => {
      await socketService.connect();
      socketService.joinMatch(matchId);

      const handleReceive = (msg: ChatMessage) => setMessages((prev) => upsertMessage(prev, msg));
      const offClosed = socketService.onMatchClosed((closedId) => {
        if (closedId === matchId) setClosed(true);
      });

      socketService.onReceiveMessage(handleReceive);

      return () => {
        socketService.offReceiveMessage(handleReceive);
        socketService.leaveMatch(matchId);
        offClosed();
      };
    };

    const cleanupPromise = setupSocket();
    return () => {
      cleanupPromise.then(cleanup => cleanup && cleanup());
    };
  }, [matchId]);

  const deliver = useCallback(async (clientId: string, text: string) => {
    setFailedIds((prev) => {
      if (!prev.has(clientId)) return prev;
      const next = new Set(prev);
      next.delete(clientId);
      return next;
    });
    const result = await socketService.sendMessage(matchId, text, clientId);
    if (result.ok) {
      setMessages((prev) => upsertMessage(prev, result.message));
    } else {
      setFailedIds((prev) => new Set(prev).add(clientId));
    }
  }, [matchId]);

  const trimmed = inputText.trim();
  const canSend = trimmed.length > 0 && !closed;

  const handleSend = () => {
    if (!canSend) return;
    setInputText('');

    // Optimistic copy; the client id ties it to the stored message.
    const clientId = Crypto.randomUUID();
    setMessages(prev => [...prev, {
      id: `temp-${clientId}`,
      sender_id: user?.id || 'unknown',
      content: trimmed,
      created_at: new Date().toISOString(),
      read_at: null,
      client_msg_id: clientId,
    }]);
    deliver(clientId, trimmed);
  };

  const rows = useMemo(() => buildRows(messages, user?.id), [messages, user?.id]);

  // Status is shown only under my most recent message.
  const lastMineId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender_id === user?.id) return messages[i].id;
    }
    return null;
  }, [messages, user?.id]);

  const scrollToEnd = () => {
    flatListRef.current?.scrollToEnd({ animated: initialScrollDone.current });
    initialScrollDone.current = true;
  };

  // Stable identity matters here: the composer's `inputText` lives in this
  // component, so a fresh renderRow on each keystroke would re-render every
  // visible message bubble while the user types. With the identity held
  // constant, VirtualizedList's cells see unchanged props and bail out.
  const renderRow = useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'day') {
      return (
        <View style={styles.dayRow}>
          <Text style={styles.dayText}>{item.label}</Text>
        </View>
      );
    }

    const { message, isMe, firstInGroup, lastInGroup } = item;
    const pending = message.id.startsWith('temp-');
    const failed = pending && !!message.client_msg_id && failedIds.has(message.client_msg_id);

    let status: string | null = null;
    if (isMe && message.id === lastMineId) {
      status = failed ? null : pending ? 'Sending' : message.read_at ? 'Seen' : 'Sent';
    }

    return (
      <View style={[styles.messageRow, isMe ? styles.rowRight : styles.rowLeft, firstInGroup && styles.groupStart]}>
        {!isMe && (
          <View style={styles.avatarSlot}>
            {lastInGroup && <Avatar uri={chatAvatar} name={chatName} size={30} />}
          </View>
        )}

        <View style={[styles.messageContent, isMe ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
          <View
            style={[
              styles.bubble,
              isMe ? styles.bubbleMe : styles.bubbleThem,
              // Flatten the corner that faces the next bubble in the same run.
              isMe
                ? [!firstInGroup && { borderTopRightRadius: 6 }, !lastInGroup && { borderBottomRightRadius: 6 }]
                : [!firstInGroup && { borderTopLeftRadius: 6 }, !lastInGroup && { borderBottomLeftRadius: 6 }],
              pending && !failed && { opacity: 0.7 },
              failed && styles.bubbleFailed,
            ]}
          >
            <Text style={[styles.messageText, isMe ? styles.textMe : styles.textThem]} selectable>
              {message.content}
            </Text>
          </View>

          {failed ? (
            <Pressable
              onPress={() => deliver(message.client_msg_id!, message.content)}
              hitSlop={8}
              accessibilityRole="button"
              style={styles.metaRow}
            >
              <Ionicons name="alert-circle" size={13} color="#FF6B6B" />
              <Text style={[styles.metaText, styles.failedText]}>Not sent. Tap to retry</Text>
            </Pressable>
          ) : lastInGroup || status ? (
            <View style={styles.metaRow}>
              {lastInGroup && <Text style={styles.metaText}>{formatTime(message.created_at)}</Text>}
              {status && (
                <Text style={[styles.metaText, lastInGroup && { marginLeft: 6 }, status === 'Seen' && { color: '#BDBDBD' }]}>
                  {status}
                </Text>
              )}
            </View>
          ) : null}
        </View>
      </View>
    );
  }, [failedIds, lastMineId, chatAvatar, chatName, deliver]);

  const keyExtractor = useCallback((row: Row) => row.key, []);

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={styles.listContent} accessibilityLabel="Loading messages">
        {[{ w: 180, me: false }, { w: 140, me: true }, { w: 220, me: false }, { w: 120, me: true }].map((b, i) => (
          <View key={i} style={[styles.messageRow, b.me ? styles.rowRight : styles.rowLeft, styles.groupStart]}>
            <View style={[styles.skeletonBubble, { width: b.w }]} />
          </View>
        ))}
      </View>
    );
  } else if (error) {
    body = (
      <View style={styles.centerContainer}>
        <Ionicons name="cloud-offline-outline" size={30} color="#BDBDBD" />
        <Text style={styles.stateTitle}>Couldn't load messages</Text>
        <Pressable
          onPress={() => setReloadKey(k => k + 1)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.stateButton, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.stateButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  } else if (messages.length === 0) {
    body = (
      <View style={styles.centerContainer}>
        <Avatar uri={chatAvatar} name={chatName} size={84} />
        <Text style={styles.stateTitle}>You matched with {chatName}</Text>
        {matchedAt && <Text style={styles.stateBody}>{dayLabel(new Date(matchedAt))}</Text>}
        <Text style={[styles.stateBody, { marginTop: 10 }]}>Send a message to start the conversation.</Text>
      </View>
    );
  } else {
    body = (
      <FlatList
        ref={flatListRef}
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderRow}
        // A long thread should not mount every bubble it has ever loaded.
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={11}
        removeClippedSubviews
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={scrollToEnd}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.headerButton} hitSlop={6} accessibilityRole="button" accessibilityLabel="Back to chats">
          <Ionicons name="chevron-back" size={26} color="#FFF" />
        </Pressable>
        <View style={styles.headerPerson}>
          <Avatar uri={chatAvatar} name={chatName} size={38} />
          <View style={{ flexShrink: 1, marginLeft: 10 }}>
            <View style={styles.headerNameRow}>
              <Text style={styles.headerName} numberOfLines={1}>{chatName}</Text>
              {chatVerified && <MaterialIcons name="verified" size={16} color={ACCENT} style={{ marginLeft: 4 }} />}
            </View>
            {matchedAt && <Text style={styles.headerSub}>{matchedLabel(matchedAt)}</Text>}
          </View>
        </View>
        {canRateThisChat && (
          <Pressable
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel={`Rate ${chatName}`}
            hitSlop={6}
            onPress={() => setRateVisible(true)}
          >
            <Ionicons name="star-outline" size={21} color="#FFF" />
          </Pressable>
        )}
        <Pressable
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel="Report or block"
          hitSlop={6}
          onPress={() =>
            openSafetyMenu({
              userId: otherUserId,
              name: chatName,
              target: { type: 'message', id: matchId },
              onBlocked: onBack,
            })
          }
        >
          <Ionicons name="ellipsis-horizontal" size={22} color="#FFF" />
        </Pressable>
      </View>

      {canRateThisChat && (
        <RateBrandSheet
          visible={rateVisible}
          brandId={otherUserId}
          brandName={chatName}
          onClose={() => setRateVisible(false)}
        />
      )}

      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}

        {closed ? (
          <View style={styles.composer}>
            <View style={styles.closedBox}>
              <Ionicons name="lock-closed-outline" size={15} color="#8A8A8A" />
              <Text style={styles.closedText}>This conversation has ended</Text>
            </View>
          </View>
        ) : (
          <View style={styles.composer}>
            <View style={styles.inputBox}>
              <TextInput
                style={[styles.textInput, webNoOutline]}
                placeholder={`Message ${chatName}`}
                placeholderTextColor="#8A8A8A"
                value={inputText}
                onChangeText={setInputText}
                multiline
                maxLength={MAX_MESSAGE_LENGTH}
                accessibilityLabel="Message"
                // Web: Enter sends, Shift+Enter adds a new line.
                onKeyPress={(e: any) => {
                  if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                    e.preventDefault?.();
                    handleSend();
                  }
                }}
              />
            </View>
            <Pressable
              onPress={handleSend}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              style={({ pressed }) => [styles.sendButton, !canSend && styles.sendButtonDisabled, pressed && styles.sendPressed]}
            >
              <Ionicons name="arrow-up" size={22} color={canSend ? '#FFF' : '#777'} />
            </Pressable>
          </View>
        )}
        {inputText.length > MAX_MESSAGE_LENGTH - 200 && (
          <Text style={styles.counter}>{inputText.length}/{MAX_MESSAGE_LENGTH}</Text>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Adds a message, replacing its optimistic copy (same client id) or an
// already-present copy (same id) so each message shows once.
function upsertMessage(prev: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const index = prev.findIndex(
    (m) => m.id === msg.id || (!!msg.client_msg_id && m.client_msg_id === msg.client_msg_id)
  );
  if (index < 0) return [...prev, msg];
  const next = [...prev];
  next[index] = msg;
  return next;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#121212' },
  flex1: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#121212',
  },
  headerButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  headerPerson: { flex: 1, flexDirection: 'row', alignItems: 'center', marginHorizontal: 4 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center' },
  headerName: { fontSize: 17, fontWeight: '700', color: '#FFF', flexShrink: 1 },
  headerSub: { fontSize: 12, color: '#8A8A8A', marginTop: 1 },
  listContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 16 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  stateTitle: { color: '#FFF', fontSize: 18, fontWeight: '700', textAlign: 'center', marginTop: 16 },
  stateBody: { color: '#9A9A9A', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 4 },
  stateButton: {
    marginTop: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 22,
  },
  stateButtonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  dayRow: { alignItems: 'center', marginTop: 18, marginBottom: 6 },
  dayText: {
    color: '#9A9A9A', fontSize: 12, fontWeight: '600',
    backgroundColor: '#1C1C1C', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10, overflow: 'hidden',
  },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 3 },
  groupStart: { marginTop: 12 },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  avatarSlot: { width: 30, marginRight: 8, marginBottom: 20 },
  messageContent: { maxWidth: '78%' },
  bubble: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  bubbleThem: { backgroundColor: '#262626' },
  bubbleMe: { backgroundColor: ACCENT },
  bubbleFailed: { backgroundColor: '#5A2A1E' },
  messageText: { fontSize: 15, lineHeight: 21 },
  textThem: { color: '#F2F2F2' },
  textMe: { color: '#FFF' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, marginHorizontal: 6 },
  metaText: { fontSize: 11, color: '#8A8A8A', fontVariant: ['tabular-nums'] },
  failedText: { color: '#FF6B6B', fontWeight: '600' },
  skeletonBubble: { height: 38, borderRadius: 19, backgroundColor: '#1E1E1E' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#121212',
  },
  inputBox: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 11 : 6,
  },
  textInput: { fontSize: 16, color: '#FFF', maxHeight: 120, padding: 0 },
  sendButton: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: ACCENT,
    justifyContent: 'center', alignItems: 'center',
  },
  sendButtonDisabled: { backgroundColor: '#262626' },
  sendPressed: { transform: [{ scale: 0.92 }] },
  closedBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 14, backgroundColor: '#1C1C1C',
  },
  closedText: { color: '#8A8A8A', fontSize: 14 },
  counter: { color: '#8A8A8A', fontSize: 11, textAlign: 'right', paddingHorizontal: 16, paddingBottom: 6 },
});
