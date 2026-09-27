import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { clearChat, muteChat, reportContent, type ReportReason } from '@/api';
import { askReportReason, confirmBlock } from '@/components/safetyMenu';
import { showAlert } from '@/components/ActionSheet';
import { useAuth } from '@/contexts/AuthContext';
import type { ChatMessage, MuteDuration } from '@/api/types';
import { Avatar } from '@/components/ChatAvatar';
import { RateBrandSheet } from '@/components/RateBrandSheet';
import { sz } from '@/theme/scale';
import { canRecordAudio, getClipboard, getDocumentPicker } from '@/utils/optionalModules';
import { useConversation } from '@/features/chat/useConversation';
import { MessageBubble } from '@/features/chat/MessageBubble';
import { Composer } from '@/features/chat/Composer';
import { VoiceRecorderBar } from '@/features/chat/VoiceRecorder';
import { VoicePlaybackProvider } from '@/features/chat/VoiceNote';
import { AttachmentSheet, type AttachmentChoice } from '@/features/chat/AttachmentSheet';
import { MessageActionsSheet, canEdit } from '@/features/chat/MessageActions';
import { ForwardSheet } from '@/features/chat/ForwardSheet';
import { MediaPreview } from '@/features/chat/MediaPreview';
import { MediaViewer } from '@/features/chat/MediaViewer';
import { Sheet, SheetAction, SheetGroup } from '@/features/chat/Sheet';
import { openLink } from '@/features/chat/LinkifiedText';
import { formatBytes, formatLastSeen, guessMime } from '@/features/chat/format';
import type { LocalFile } from '@/features/chat/upload';

const ACCENT = '#FF6B2B';
const GROUP_GAP_MS = 5 * 60 * 1000;
const MB = 1024 * 1024;
// The server's limits (backend/src/utils/chatStorage.js), checked here first
// so a too-big file fails before its upload, not after.
const MAX_BYTES = { image: 16 * MB, video: 50 * MB, audio: 16 * MB, document: 50 * MB };

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
  | { kind: 'unread'; key: string }
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

// Adds day separators and the unread divider, and marks where runs of
// messages from one sender start and end. Oldest first.
function buildRows(messages: ChatMessage[], myId: string | undefined, firstUnreadId: string | null): Row[] {
  const rows: Row[] = [];
  messages.forEach((message, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const at = new Date(message.created_at);
    if (!prev || !sameDay(new Date(prev.created_at), at)) {
      rows.push({ kind: 'day', key: `day-${message.created_at}`, label: dayLabel(at) });
    }
    if (message.id === firstUnreadId) rows.push({ kind: 'unread', key: 'unread' });
    const joinsPrev = !!prev && prev.sender_id === message.sender_id
      && sameDay(new Date(prev.created_at), at)
      && at.getTime() - new Date(prev.created_at).getTime() < GROUP_GAP_MS;
    const joinsNext = !!next && next.sender_id === message.sender_id
      && sameDay(new Date(next.created_at), at)
      && new Date(next.created_at).getTime() - at.getTime() < GROUP_GAP_MS;
    rows.push({
      kind: 'message',
      // The client id survives the optimistic copy being replaced, so the
      // bubble is updated in place instead of remounting.
      key: message.client_msg_id ? `c-${message.client_msg_id}` : message.id,
      message,
      isMe: message.sender_id === myId,
      firstInGroup: !joinsPrev || message.id === firstUnreadId,
      lastInGroup: !joinsNext,
    });
  });
  return rows;
}

function assetToFile(a: ImagePicker.ImagePickerAsset): LocalFile {
  const video = a.type === 'video' || !!a.mimeType?.startsWith('video/');
  return {
    kind: video ? 'video' : 'image',
    uri: a.uri,
    mime: a.mimeType || (video ? 'video/mp4' : 'image/jpeg'),
    name: a.fileName ?? undefined,
    size: a.fileSize ?? null,
    width: a.width || undefined,
    height: a.height || undefined,
    duration_ms: video && a.duration ? Math.round(a.duration) : undefined,
    webFile: Platform.OS === 'web' ? (a as any).file : undefined,
  };
}

function tooBig(file: LocalFile) {
  return !!file.size && file.size > MAX_BYTES[file.kind];
}

type HeaderMenu = null | 'main' | 'mute';

export function ConversationScreen({ matchId, otherUserId, chatName, chatAvatar, chatVerified, matchedAt, onBack }: Props) {
  const { user, onboardingData } = useAuth();
  const myId = user?.id;
  const role = onboardingData?.role?.toLowerCase() as 'brand' | 'influencer' | undefined;
  // Only creators rate brands, and only the person they are talking to.
  const canRateThisChat = onboardingData?.role === 'Influencer';
  const [rateVisible, setRateVisible] = useState(false);

  const chat = useConversation({ matchId, myId, otherUserId });
  const { messages, sendStates, memberState } = chat;

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [recording, setRecording] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [previewFiles, setPreviewFiles] = useState<LocalFile[] | null>(null);
  const [viewing, setViewing] = useState<ChatMessage | null>(null);
  const [headerMenu, setHeaderMenu] = useState<HeaderMenu>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [newWhileAway, setNewWhileAway] = useState(0);

  const listRef = useRef<FlatList<Row>>(null);
  const scrolledUp = useRef(false);
  const canRecord = useMemo(() => canRecordAudio(), []);
  const muted = !!memberState?.muted_until && new Date(memberState.muted_until) > new Date();

  const rows = useMemo(() => buildRows(messages, myId, chat.firstUnreadId), [messages, myId, chat.firstUnreadId]);
  // Inverted list: newest first, so it opens at the bottom and pages upward.
  const listRows = useMemo(() => [...rows].reverse(), [rows]);

  // Counts what arrives while scrolled up, for the jump-to-latest button.
  const lastCount = useRef(messages.length);
  useEffect(() => {
    const newest = messages[messages.length - 1];
    if (messages.length > lastCount.current && newest && newest.sender_id !== myId && scrolledUp.current) {
      setNewWhileAway((n) => n + 1);
    }
    lastCount.current = messages.length;
  }, [messages, myId]);

  const scrollToLatest = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setNewWhileAway(0);
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const up = e.nativeEvent.contentOffset.y > 320;
    scrolledUp.current = up;
    setShowJump((prev) => (prev === up ? prev : up));
    if (!up) setNewWhileAway(0);
  }, []);

  // ── Jumping to a quoted message ──────────────────────────────────
  const listRowsRef = useRef(listRows);
  listRowsRef.current = listRows;
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);

  const jumpTo = useCallback(async (messageId: string) => {
    const findIndex = () => listRowsRef.current.findIndex((r) => r.kind === 'message' && r.message.id === messageId);
    let index = findIndex();
    // Older than what is loaded: page back a few times to find it.
    for (let tries = 0; index < 0 && tries < 5 && chat.hasMore; tries++) {
      await chat.loadOlder();
      await new Promise((r) => setTimeout(r, 50));
      index = findIndex();
    }
    if (index < 0) {
      showAlert('Message not found', 'It may have been deleted.');
      return;
    }
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    setHighlightId(messageId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 1600);
  }, [chat]);

  // ── Sending ──────────────────────────────────────────────────────
  const submitText = useCallback((text: string) => {
    if (editing) {
      chat.edit(editing, text);
      setEditing(null);
      return;
    }
    chat.sendText(text, replyTo);
    setReplyTo(null);
    scrollToLatest();
  }, [chat, editing, replyTo, scrollToLatest]);

  const sendFiles = useCallback((files: LocalFile[], caption: string) => {
    const big = files.find(tooBig);
    if (big) {
      showAlert('File too large', `${big.kind === 'image' ? 'Photos' : big.kind === 'video' ? 'Videos' : 'Files'} can be up to ${MAX_BYTES[big.kind] / MB} MB.`);
      return;
    }
    chat.sendFiles(files, caption, replyTo);
    setReplyTo(null);
    scrollToLatest();
  }, [chat, replyTo, scrollToLatest]);

  const choose = useCallback(async (choice: AttachmentChoice) => {
    try {
      if (choice === 'document') {
        const picker = getDocumentPicker();
        if (!picker) return;
        const res = await picker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true });
        if (res.canceled || !res.assets?.length) return;
        const a = res.assets[0];
        const file: LocalFile = {
          kind: 'document',
          uri: a.uri,
          mime: a.mimeType || guessMime(a.name),
          name: a.name,
          size: a.size ?? null,
          webFile: a.file,
        };
        if (tooBig(file)) {
          showAlert('File too large', 'Documents can be up to 50 MB.');
          return;
        }
        showAlert(`Send to ${chatName}?`, `${a.name}${a.size ? ` · ${formatBytes(a.size)}` : ''}`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Send', onPress: () => sendFiles([file], '') },
        ]);
        return;
      }

      if (choice === 'camera' && Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          showAlert('Camera access needed', 'Allow camera access for Matchr in Settings to take photos and videos.');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images', 'videos'],
        // Re-encodes to JPEG, which every phone and browser can show (not HEIC).
        quality: 0.8,
        videoMaxDuration: 300,
      };
      const res = choice === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: 10, orderedSelection: true });
      if (res.canceled || !res.assets?.length) return;
      setPreviewFiles(res.assets.map(assetToFile));
    } catch (err) {
      console.warn('[Chat] picker failed', err);
      showAlert('Could not open', 'Please try again.');
    }
  }, [chatName, sendFiles]);

  // ── Message actions ──────────────────────────────────────────────
  const copy = useCallback(async (m: ChatMessage) => {
    try {
      const clipboard = getClipboard();
      if (clipboard) await clipboard.setStringAsync(m.content);
      else if (Platform.OS === 'web') await navigator.clipboard?.writeText(m.content);
    } catch {
      showAlert('Could not copy');
    }
  }, []);

  const report = useCallback((m: ChatMessage) => {
    const reasons: { text: string; value: ReportReason }[] = [
      { text: 'Spam', value: 'spam' },
      { text: 'Inappropriate', value: 'inappropriate' },
      { text: 'Harassment', value: 'harassment' },
    ];
    showAlert('Report message', 'Our team will see this message and the few around it.', [
      ...reasons.map(({ text, value }) => ({
        text,
        onPress: async () => {
          try {
            await reportContent('message', m.id, value);
            showAlert('Thanks for letting us know', 'Our team will review this report.');
          } catch {
            showAlert('Report failed', 'Please try again.');
          }
        },
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, []);

  const openDocument = useCallback((m: ChatMessage) => {
    const url = m.attachment?.url;
    if (url) openLink(url);
    else showAlert('Not available yet', 'Reopen the chat and try again.');
  }, []);

  const openMedia = useCallback((m: ChatMessage) => {
    if (m.deleted_at || !m.attachment) return;
    setViewing(m);
  }, []);

  // Stable identities so the memoised bubbles only re-render when their own
  // message changes; the latest state is read through the refs.
  const latest = useRef({ chat, myId });
  latest.current = { chat, myId };
  const jumpToRef = useRef(jumpTo);
  jumpToRef.current = jumpTo;
  const bubbleHandlers = useMemo(() => ({
    onLongPress: (m: ChatMessage) => setMenuFor(m),
    onOpenMedia: openMedia,
    onOpenDocument: openDocument,
    onQuotePress: (id: string) => jumpToRef.current(id),
    onRetry: (clientId: string) => latest.current.chat.retry(clientId),
    onDiscard: (clientId: string) => latest.current.chat.discard(clientId),
    onReactionPress: (m: ChatMessage) => {
      const mine = m.reactions?.find((r) => r.user_id === latest.current.myId);
      // Tapping your own reaction takes it back, as on WhatsApp.
      if (mine) latest.current.chat.react(m, null);
      else setMenuFor(m);
    },
    onReply: (m: ChatMessage) => {
      setEditing(null);
      setReplyTo(m);
    },
  }), [openDocument, openMedia]);

  const actionHandlers = useMemo(() => ({
    onReact: (m: ChatMessage, emoji: string | null) => latest.current.chat.react(m, emoji),
    onReply: (m: ChatMessage) => { setEditing(null); setReplyTo(m); },
    onCopy: getClipboard() || Platform.OS === 'web' ? copy : undefined,
    onEdit: (m: ChatMessage) => {
      if (!canEdit(m, latest.current.myId)) return;
      setReplyTo(null);
      setEditing(m);
    },
    onForward: (m: ChatMessage) => setForwarding(m),
    onOpen: (m: ChatMessage) => (m.kind === 'document' ? openDocument(m) : m.attachment?.url && openLink(m.attachment.url)),
    onDeleteForMe: (m: ChatMessage) => latest.current.chat.deleteForMe(m),
    onDeleteForEveryone: (m: ChatMessage) => latest.current.chat.deleteForEveryone(m),
    onReport: report,
    onDiscard: (m: ChatMessage) => m.client_msg_id && latest.current.chat.discard(m.client_msg_id),
  }), [copy, openDocument, report]);

  // ── Header menu ──────────────────────────────────────────────────
  const setMute = useCallback(async (duration: MuteDuration | null) => {
    setHeaderMenu(null);
    try {
      const res = await muteChat(matchId, duration);
      chat.setMemberState((prev) => ({ cleared_at: prev?.cleared_at ?? null, muted_until: res.muted_until }));
    } catch {
      showAlert('Could not update notifications', 'Please try again.');
    }
  }, [chat, matchId]);

  const confirmClear = useCallback(() => {
    setHeaderMenu(null);
    showAlert('Clear this chat?', `Messages disappear for you only. ${chatName} still has them.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear chat',
        style: 'destructive',
        onPress: async () => {
          try {
            await clearChat(matchId);
            // The server's 'chat_cleared' event removes them from this screen.
          } catch {
            showAlert('Could not clear the chat', 'Please try again.');
          }
        },
      },
    ]);
  }, [chatName, matchId]);

  // ── Rendering ────────────────────────────────────────────────────
  const renderRow = useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'day') {
      return (
        <View style={styles.dayRow}>
          <Text style={styles.dayText}>{item.label}</Text>
        </View>
      );
    }
    if (item.kind === 'unread') {
      return (
        <View style={styles.unreadRow} accessibilityRole="text">
          <Text style={styles.unreadText}>Unread messages</Text>
        </View>
      );
    }
    const m = item.message;
    return (
      <MessageBubble
        message={m}
        isMe={item.isMe}
        firstInGroup={item.firstInGroup}
        lastInGroup={item.lastInGroup}
        myId={myId}
        chatName={chatName}
        chatAvatar={chatAvatar}
        send={m.client_msg_id ? sendStates[m.client_msg_id] : undefined}
        highlighted={highlightId === m.id}
        {...bubbleHandlers}
      />
    );
  }, [myId, chatName, chatAvatar, sendStates, highlightId, bubbleHandlers]);

  const keyExtractor = useCallback((row: Row) => row.key, []);

  const typingLabel = chat.otherTyping === 'audio' ? 'recording audio…' : chat.otherTyping === 'text' ? 'typing…' : null;
  const subtitle = typingLabel
    ?? (chat.presence?.online ? 'online' : formatLastSeen(chat.presence?.last_seen_at))
    ?? (matchedAt ? matchedLabel(matchedAt) : null);

  let body: React.ReactNode;
  if (chat.loading && !messages.length) {
    body = (
      <View style={styles.listContent} accessibilityLabel="Loading messages">
        {[{ w: 180, me: false }, { w: 140, me: true }, { w: 220, me: false }, { w: 120, me: true }].map((b, i) => (
          <View key={i} style={[styles.skeletonRow, b.me ? styles.rowRight : styles.rowLeft]}>
            <View style={[styles.skeletonBubble, { width: sz(b.w) }]} />
          </View>
        ))}
      </View>
    );
  } else if (chat.error && !messages.length) {
    body = (
      <View style={styles.centerContainer}>
        <Ionicons name="cloud-offline-outline" size={sz(30)} color="#BDBDBD" />
        <Text style={styles.stateTitle}>Couldn't load messages</Text>
        <Pressable
          onPress={chat.reload}
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
        <Avatar uri={chatAvatar} name={chatName} size={sz(84)} />
        <Text style={styles.stateTitle}>You matched with {chatName}</Text>
        {matchedAt && <Text style={styles.stateBody}>{dayLabel(new Date(matchedAt))}</Text>}
        <Text style={[styles.stateBody, { marginTop: sz(10) }]}>
          Send a message, a photo, a document or a voice note to start the conversation.
        </Text>
      </View>
    );
  } else {
    body = (
      <View style={styles.flex1}>
        <FlatList
          ref={listRef}
          data={listRows}
          inverted
          keyExtractor={keyExtractor}
          renderItem={renderRow}
          // A long thread should not mount every bubble it has ever loaded.
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={11}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onEndReached={chat.loadOlder}
          onEndReachedThreshold={0.5}
          onScroll={onScroll}
          scrollEventThrottle={64}
          maintainVisibleContentPosition={{ minIndexForVisible: 1, autoscrollToTopThreshold: 80 }}
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true }), 120);
          }}
          ListFooterComponent={
            chat.loadingOlder ? (
              <ActivityIndicator color={ACCENT} style={{ marginVertical: sz(16) }} />
            ) : !chat.hasMore ? (
              <View style={styles.beginning}>
                <Ionicons name="lock-closed" size={sz(12)} color="#8A8A8A" />
                <Text style={styles.beginningText}>
                  Messages are private to you and {chatName}.{matchedAt ? ` ${matchedLabel(matchedAt)}.` : ''}
                </Text>
              </View>
            ) : null
          }
        />
        {showJump && (
          <Pressable
            onPress={scrollToLatest}
            style={styles.jump}
            accessibilityRole="button"
            accessibilityLabel={newWhileAway ? `${newWhileAway} new messages, scroll to latest` : 'Scroll to latest'}
          >
            {newWhileAway > 0 && (
              <View style={styles.jumpBadge}><Text style={styles.jumpBadgeText}>{newWhileAway}</Text></View>
            )}
            <Ionicons name="chevron-down" size={sz(22)} color="#FFF" />
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <VoicePlaybackProvider>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={onBack} style={styles.headerButton} hitSlop={6} accessibilityRole="button" accessibilityLabel="Back to chats">
            <Ionicons name="chevron-back" size={sz(26)} color="#FFF" />
          </Pressable>
          <View style={styles.headerPerson}>
            <View>
              <Avatar uri={chatAvatar} name={chatName} size={sz(38)} />
              {chat.presence?.online && <View style={styles.onlineDot} />}
            </View>
            <View style={{ flexShrink: 1, marginLeft: sz(10) }}>
              <View style={styles.headerNameRow}>
                <Text style={styles.headerName} numberOfLines={1}>{chatName}</Text>
                {chatVerified && <MaterialIcons name="verified" size={sz(16)} color={ACCENT} style={{ marginLeft: sz(4) }} />}
                {muted && <Ionicons name="notifications-off" size={sz(13)} color="#8A8A8A" style={{ marginLeft: sz(6) }} />}
              </View>
              {subtitle && (
                <Text style={[styles.headerSub, typingLabel && styles.headerTyping]} numberOfLines={1} accessibilityLiveRegion="polite">
                  {subtitle}
                </Text>
              )}
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
              <Ionicons name="star-outline" size={sz(21)} color="#FFF" />
            </Pressable>
          )}
          <Pressable
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Chat options"
            hitSlop={6}
            onPress={() => setHeaderMenu('main')}
          >
            <Ionicons name="ellipsis-horizontal" size={sz(22)} color="#FFF" />
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

          {chat.closed ? (
            <View style={styles.closedWrap}>
              <View style={styles.closedBox}>
                <Ionicons name="lock-closed-outline" size={sz(15)} color="#8A8A8A" />
                <Text style={styles.closedText}>This conversation has ended</Text>
              </View>
            </View>
          ) : recording ? (
            <VoiceRecorderBar
              onSend={(file) => {
                setRecording(false);
                sendFiles([file], '');
              }}
              onCancel={() => setRecording(false)}
              onRecordingChange={chat.notifyRecording}
            />
          ) : (
            <Composer
              matchId={matchId}
              chatName={chatName}
              myId={myId}
              replyTo={replyTo}
              editing={editing}
              canAttach
              canRecord={canRecord}
              onCancelReply={() => setReplyTo(null)}
              onCancelEdit={() => setEditing(null)}
              onSubmit={submitText}
              onAttach={() => setAttachOpen(true)}
              onCamera={() => choose('camera')}
              onRecord={() => setRecording(true)}
              onTyping={chat.notifyTyping}
            />
          )}
        </KeyboardAvoidingView>

        <AttachmentSheet
          visible={attachOpen}
          onClose={() => setAttachOpen(false)}
          onChoose={choose}
          available={{ library: true, camera: true, document: !!getDocumentPicker() }}
        />

        <MessageActionsSheet
          message={menuFor}
          myId={myId}
          onClose={() => setMenuFor(null)}
          handlers={actionHandlers}
        />

        <ForwardSheet
          visible={!!forwarding}
          role={role}
          onClose={() => setForwarding(null)}
          onForward={async (matchIds) => {
            if (forwarding) await chat.forward(forwarding, matchIds);
          }}
        />

        <MediaPreview
          files={previewFiles}
          chatName={chatName}
          onCancel={() => setPreviewFiles(null)}
          onSend={(files, caption) => {
            setPreviewFiles(null);
            sendFiles(files, caption);
          }}
        />

        <MediaViewer
          message={viewing}
          senderName={viewing ? (viewing.sender_id === myId ? 'You' : chatName) : ''}
          onClose={() => setViewing(null)}
          onReply={(m) => { setViewing(null); setEditing(null); setReplyTo(m); }}
          onForward={(m) => { setViewing(null); setForwarding(m); }}
        />

        <Sheet visible={headerMenu !== null} onClose={() => setHeaderMenu(null)} title={headerMenu === 'mute' ? 'Mute notifications' : chatName}>
          {headerMenu === 'mute' ? (
            <SheetGroup>
              <SheetAction first icon="time-outline" label="8 hours" onPress={() => setMute('8h')} />
              <SheetAction icon="calendar-outline" label="1 week" onPress={() => setMute('1w')} />
              <SheetAction icon="notifications-off-outline" label="Always" onPress={() => setMute('always')} />
            </SheetGroup>
          ) : (
            <>
              <SheetGroup>
                <SheetAction
                  first
                  icon={muted ? 'notifications-outline' : 'notifications-off-outline'}
                  label={muted ? 'Unmute notifications' : 'Mute notifications'}
                  onPress={() => (muted ? setMute(null) : setHeaderMenu('mute'))}
                />
                <SheetAction icon="trash-bin-outline" label="Clear chat" onPress={confirmClear} />
              </SheetGroup>
              <SheetGroup>
                <SheetAction
                  first
                  icon="flag-outline"
                  label={`Report ${chatName}`}
                  onPress={() => { setHeaderMenu(null); askReportReason('user', otherUserId); }}
                />
                <SheetAction
                  icon="ban-outline"
                  label={`Block ${chatName}`}
                  destructive
                  onPress={() => { setHeaderMenu(null); confirmBlock(otherUserId, chatName, onBack); }}
                />
              </SheetGroup>
            </>
          )}
          <Pressable onPress={() => setHeaderMenu(null)} style={styles.sheetCancel} accessibilityRole="button">
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </Pressable>
        </Sheet>
      </SafeAreaView>
    </VoicePlaybackProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#121212' },
  flex1: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: sz(8),
    paddingVertical: sz(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#121212',
  },
  headerButton: { width: sz(40), height: sz(40), borderRadius: sz(20), justifyContent: 'center', alignItems: 'center' },
  headerPerson: { flex: 1, flexDirection: 'row', alignItems: 'center', marginHorizontal: sz(4) },
  headerNameRow: { flexDirection: 'row', alignItems: 'center' },
  headerName: { fontSize: sz(17), fontWeight: '700', color: '#FFF', flexShrink: 1 },
  headerSub: { fontSize: sz(12), color: '#8A8A8A', marginTop: 1 },
  headerTyping: { color: '#FF8A55', fontWeight: '600' },
  onlineDot: {
    position: 'absolute', right: 0, bottom: 0, width: sz(11), height: sz(11), borderRadius: sz(6),
    backgroundColor: '#2FD06B', borderWidth: 2, borderColor: '#121212',
  },
  listContent: { paddingHorizontal: sz(12), paddingTop: sz(12), paddingBottom: sz(12) },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: sz(40) },
  stateTitle: { color: '#FFF', fontSize: sz(18), fontWeight: '700', textAlign: 'center', marginTop: sz(16) },
  stateBody: { color: '#9A9A9A', fontSize: sz(14), lineHeight: sz(20), textAlign: 'center', marginTop: sz(4) },
  stateButton: {
    marginTop: sz(18), borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: sz(12),
    paddingVertical: sz(10), paddingHorizontal: sz(22),
  },
  stateButtonText: { color: '#FFF', fontSize: sz(15), fontWeight: '600' },
  dayRow: { alignItems: 'center', marginTop: sz(16), marginBottom: sz(4) },
  dayText: {
    color: '#9A9A9A', fontSize: sz(12), fontWeight: '600',
    backgroundColor: '#1C1C1C', paddingHorizontal: sz(12), paddingVertical: sz(4), borderRadius: sz(10), overflow: 'hidden',
  },
  unreadRow: { alignItems: 'center', marginTop: sz(14), marginBottom: sz(2), paddingVertical: sz(5), backgroundColor: 'rgba(255,107,43,0.1)' },
  unreadText: { color: '#FF8A55', fontSize: sz(12), fontWeight: '700' },
  beginning: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sz(6), alignSelf: 'center',
    marginVertical: sz(14), paddingHorizontal: sz(12), paddingVertical: sz(6), borderRadius: sz(10),
    backgroundColor: '#1A1A1A', maxWidth: '90%',
  },
  beginningText: { color: '#8A8A8A', fontSize: sz(12), textAlign: 'center', flexShrink: 1 },
  skeletonRow: { flexDirection: 'row', marginTop: sz(12) },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  skeletonBubble: { height: sz(38), borderRadius: sz(19), backgroundColor: '#1E1E1E' },
  jump: {
    position: 'absolute', right: sz(14), bottom: sz(14), width: sz(42), height: sz(42), borderRadius: sz(21),
    backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.15)',
  },
  jumpBadge: {
    position: 'absolute', top: sz(-6), right: sz(-4), minWidth: sz(20), height: sz(20), borderRadius: sz(10),
    backgroundColor: ACCENT, paddingHorizontal: sz(5), justifyContent: 'center', alignItems: 'center',
  },
  jumpBadgeText: { color: '#FFF', fontSize: sz(11), fontWeight: '700' },
  closedWrap: {
    paddingHorizontal: sz(12), paddingTop: sz(8), paddingBottom: sz(10),
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)', backgroundColor: '#121212',
  },
  closedBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sz(6),
    paddingVertical: sz(12), borderRadius: sz(14), backgroundColor: '#1C1C1C',
  },
  closedText: { color: '#8A8A8A', fontSize: sz(14) },
  sheetCancel: {
    marginTop: sz(10), minHeight: sz(52), borderRadius: sz(16), backgroundColor: '#1C1C1C',
    justifyContent: 'center', alignItems: 'center',
  },
  sheetCancelText: { color: '#FFF', fontSize: sz(16), fontWeight: '600' },
});
