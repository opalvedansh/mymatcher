import React, { memo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { ChatMessage } from '@/api/types';
import { Avatar } from '@/components/ChatAvatar';
import { tapFeedback } from '@/utils/optionalModules';
import { sz } from '@/theme/scale';
import { LinkifiedText } from './LinkifiedText';
import { VoiceNote } from './VoiceNote';
import { mediaSource } from './MediaViewer';
import { describeMessage, fileTypeLabel, fileVisual, formatBytes, formatClock, formatDuration } from './format';

const ACCENT = '#FF6B2B';
// Read ticks on the orange bubble: WhatsApp's light blue is illegible on
// orange, this navy keeps 3.5:1 against it.
const READ_TICK_ON_ACCENT = '#0B3D91';
const READ_TICK_ON_DARK = '#53BDEB';
const SWIPE_TRIGGER = 56;

export type SendState = { status: 'uploading' | 'sending' | 'failed'; progress?: number; error?: string };

type TickState = 'pending' | 'failed' | 'sent' | 'delivered' | 'read';

function tickState(message: ChatMessage, send?: SendState): TickState {
  if (send?.status === 'failed') return 'failed';
  if (message.id.startsWith('temp-')) return 'pending';
  if (message.read_at) return 'read';
  if (message.delivered_at) return 'delivered';
  return 'sent';
}

const TICK_ICON: Record<TickState, React.ComponentProps<typeof Ionicons>['name']> = {
  pending: 'time-outline',
  failed: 'alert-circle',
  sent: 'checkmark',
  delivered: 'checkmark-done',
  read: 'checkmark-done',
};

const TICK_LABEL: Record<TickState, string> = {
  pending: 'Sending',
  failed: 'Not sent',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
};

function Meta({ message, clock, isMe, send, onMedia }: {
  message: ChatMessage; clock: string; isMe: boolean; send?: SendState; onMedia?: boolean;
}) {
  const ticks = isMe ? tickState(message, send) : null;
  const color = onMedia ? '#FFF' : isMe ? 'rgba(255,255,255,0.82)' : '#9A9A9A';
  const tickColor = ticks === 'read' ? (onMedia ? READ_TICK_ON_DARK : READ_TICK_ON_ACCENT) : ticks === 'failed' ? '#FFD2CC' : color;
  return (
    <View
      style={[styles.meta, onMedia && styles.metaOnMedia]}
      accessible
      accessibilityLabel={`${message.edited_at ? 'Edited, ' : ''}${clock}${ticks ? `, ${TICK_LABEL[ticks]}` : ''}`}
    >
      {!!message.edited_at && !message.deleted_at && <Text style={[styles.metaText, { color }]}>Edited</Text>}
      <Text style={[styles.metaText, { color }]}>{clock}</Text>
      {ticks && <Ionicons name={TICK_ICON[ticks]} size={sz(15)} color={tickColor} />}
    </View>
  );
}

/** Invisible copy of the meta at the end of the text, so the real one never overlaps it. */
function MetaSpacer({ message, clock, isMe }: { message: ChatMessage; clock: string; isMe: boolean }) {
  return (
    <Text style={[styles.metaText, styles.spacer]}>
      {'   '}
      {message.edited_at ? 'Edited ' : ''}
      {clock}
      {isMe ? '  ' : ''}
    </Text>
  );
}

function mediaSize(width?: number, height?: number) {
  const w = sz(240);
  if (!width || !height) return { width: w, height: w };
  const ratio = Math.max(0.6, Math.min(1.4, height / width));
  return { width: w, height: Math.round(w * ratio) };
}

function Quote({ message, isMe, myId, chatName, onPress }: {
  message: ChatMessage; isMe: boolean; myId?: string; chatName: string; onPress: (id: string) => void;
}) {
  const reply = message.reply_to!;
  const fromMe = reply.sender_id === myId;
  const text = reply.deleted
    ? 'This message was deleted'
    : describeMessage(reply.kind, reply.text, { name: reply.name, duration_ms: reply.duration_ms });
  return (
    <Pressable
      onPress={() => onPress(reply.id)}
      style={[styles.quote, isMe ? styles.quoteMe : styles.quoteThem]}
      accessibilityRole="button"
      accessibilityLabel={`Reply to ${fromMe ? 'you' : chatName}: ${text}`}
    >
      <View style={[styles.quoteBar, { backgroundColor: fromMe ? '#FFD9C7' : '#FF8A55' }]} />
      <View style={styles.quoteBody}>
        <Text style={[styles.quoteName, { color: isMe ? '#FFF' : '#FF8A55' }]} numberOfLines={1}>
          {fromMe ? 'You' : chatName}
        </Text>
        <Text style={[styles.quoteText, reply.deleted && styles.italic]} numberOfLines={2}>{text}</Text>
      </View>
      {reply.thumb_url && !reply.deleted && (
        <Image source={{ uri: reply.thumb_url, cacheKey: reply.thumb_key ?? undefined }} style={styles.quoteThumb} contentFit="cover" />
      )}
    </Pressable>
  );
}

function UploadOverlay({ send, clientId, onRetry, onDiscard }: {
  send?: SendState; clientId?: string | null; onRetry: (id: string) => void; onDiscard: (id: string) => void;
}) {
  if (!send || !clientId) return null;
  if (send.status === 'failed') {
    return (
      <View style={styles.mediaOverlay}>
        <Pressable onPress={() => onRetry(clientId)} style={styles.overlayButton} accessibilityRole="button" accessibilityLabel="Retry sending">
          <Ionicons name="refresh" size={sz(22)} color="#FFF" />
        </Pressable>
        <Pressable onPress={() => onDiscard(clientId)} hitSlop={8} style={styles.overlayDiscard} accessibilityRole="button" accessibilityLabel="Discard">
          <Ionicons name="close" size={sz(16)} color="#FFF" />
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.mediaOverlay}>
      <Pressable onPress={() => onDiscard(clientId)} style={styles.overlayButton} accessibilityRole="button" accessibilityLabel="Cancel upload">
        <ActivityIndicator color="#FFF" style={StyleSheet.absoluteFill} />
        <Ionicons name="close" size={sz(16)} color="#FFF" />
      </Pressable>
      {send.status === 'uploading' && send.progress !== undefined && (
        <Text style={styles.overlayText}>{Math.round(send.progress * 100)}%</Text>
      )}
    </View>
  );
}

function SwipeToReply({ enabled, onReply, children }: { enabled: boolean; onReply: () => void; children: React.ReactNode }) {
  const x = useSharedValue(0);
  const armed = useSharedValue(false);

  const pan = Gesture.Pan()
    .enabled(enabled)
    // Rightward drags only, and never while the list is scrolling vertically.
    .activeOffsetX(14)
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      x.value = Math.max(0, Math.min(e.translationX * 0.55, SWIPE_TRIGGER + 30));
      if (x.value >= SWIPE_TRIGGER && !armed.value) {
        armed.value = true;
        runOnJS(tapFeedback)('selection');
      } else if (x.value < SWIPE_TRIGGER && armed.value) {
        armed.value = false;
      }
    })
    .onEnd(() => {
      if (armed.value) runOnJS(onReply)();
      armed.value = false;
      x.value = withSpring(0, { damping: 18, stiffness: 220 });
    });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const iconStyle = useAnimatedStyle(() => {
    const p = Math.min(1, x.value / SWIPE_TRIGGER);
    return { opacity: p, transform: [{ scale: 0.6 + p * 0.4 }] };
  });

  return (
    <GestureDetector gesture={pan}>
      <View>
        <Animated.View style={[styles.swipeIcon, iconStyle]} pointerEvents="none">
          <Ionicons name="arrow-undo" size={sz(18)} color="#FFF" />
        </Animated.View>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

export interface MessageBubbleProps {
  message: ChatMessage;
  isMe: boolean;
  firstInGroup: boolean;
  lastInGroup: boolean;
  myId?: string;
  chatName: string;
  chatAvatar?: string;
  send?: SendState;
  highlighted?: boolean;
  onLongPress: (message: ChatMessage) => void;
  onOpenMedia: (message: ChatMessage) => void;
  onOpenDocument: (message: ChatMessage) => void;
  onQuotePress: (messageId: string) => void;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
  onReactionPress: (message: ChatMessage) => void;
  onReply: (message: ChatMessage) => void;
}

function MessageBubbleImpl(props: MessageBubbleProps) {
  const {
    message, isMe, firstInGroup, lastInGroup, myId, chatName, chatAvatar, send, highlighted,
    onLongPress, onOpenMedia, onOpenDocument, onQuotePress, onRetry, onDiscard, onReactionPress, onReply,
  } = props;
  const [hovered, setHovered] = useState(false);

  const kind = message.kind ?? 'text';
  const deleted = !!message.deleted_at;
  const pending = message.id.startsWith('temp-');
  const failed = send?.status === 'failed';
  const att = message.attachment;
  const isVisualMedia = !deleted && (kind === 'image' || kind === 'video');
  const caption = deleted ? '' : message.content;
  const uploading = send?.status === 'uploading' ? send.progress ?? 0 : send?.status === 'sending' ? 1 : undefined;
  // Formatted once and shared by the meta and its spacer.
  const clock = formatClock(message.created_at);

  const reactions = message.reactions ?? [];
  const reactionGroups = reactions.reduce<Record<string, number>>((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
    return acc;
  }, {});

  const textColor = isMe ? styles.textMe : styles.textThem;
  const linkColor = isMe ? { color: '#FFF' } : { color: '#FF9C6E' };

  let body: React.ReactNode;
  if (deleted) {
    body = (
      <View style={styles.textBlock}>
        <Text style={[styles.messageText, styles.deletedText]}>
          <Ionicons name="ban-outline" size={sz(14)} color={isMe ? 'rgba(255,255,255,0.75)' : '#8A8A8A'} />
          {isMe ? '  You deleted this message' : '  This message was deleted'}
          <MetaSpacer message={message} clock={clock} isMe={isMe} />
        </Text>
        <Meta message={message} clock={clock} isMe={isMe} send={send} />
      </View>
    );
  } else if (isVisualMedia) {
    const size = mediaSize(att?.width, att?.height);
    const source = mediaSource(message);
    body = (
      <>
        <Pressable
          onPress={() => !pending && onOpenMedia(message)}
          onLongPress={() => onLongPress(message)}
          delayLongPress={300}
          style={[styles.media, size]}
          accessibilityRole="imagebutton"
          accessibilityLabel={kind === 'video' ? `Video, ${formatDuration(att?.duration_ms)}` : 'Photo'}
        >
          {kind === 'image' && source ? (
            <Image source={source} style={[styles.mediaImage, size]} contentFit="cover" transition={150} recyclingKey={message.client_msg_id ?? att?.key} />
          ) : (
            <View style={[styles.videoTile, size]}>
              <View style={styles.playCircle}>
                <Ionicons name="play" size={sz(26)} color="#FFF" style={{ marginLeft: 3 }} />
              </View>
            </View>
          )}
          {kind === 'video' && (
            <View style={styles.videoBadge}>
              <Ionicons name="videocam" size={sz(12)} color="#FFF" />
              <Text style={styles.videoBadgeText}>{formatDuration(att?.duration_ms)}</Text>
            </View>
          )}
          {!caption && <Meta message={message} clock={clock} isMe={isMe} send={send} onMedia />}
          <UploadOverlay send={send} clientId={message.client_msg_id} onRetry={onRetry} onDiscard={onDiscard} />
        </Pressable>
        {!!caption && (
          <View style={[styles.textBlock, { maxWidth: size.width }]}>
            <LinkifiedText text={caption} style={[styles.messageText, textColor]} linkStyle={linkColor}>
              <MetaSpacer message={message} clock={clock} isMe={isMe} />
            </LinkifiedText>
            <Meta message={message} clock={clock} isMe={isMe} send={send} />
          </View>
        )}
      </>
    );
  } else if (kind === 'audio') {
    body = (
      <View style={styles.audioBlock}>
        <VoiceNote
          id={message.client_msg_id || message.id}
          url={att?.local_uri || att?.url || null}
          durationMs={att?.duration_ms}
          waveform={att?.waveform}
          isMe={isMe}
          uploading={uploading}
        />
        <Meta message={message} clock={clock} isMe={isMe} send={send} />
      </View>
    );
  } else if (kind === 'document') {
    const visual = fileVisual(att?.name, att?.mime);
    body = (
      <>
        <Pressable
          onPress={() => !pending && onOpenDocument(message)}
          onLongPress={() => onLongPress(message)}
          delayLongPress={300}
          style={[styles.doc, isMe ? styles.docMe : styles.docThem]}
          accessibilityRole="button"
          accessibilityLabel={`Document ${att?.name ?? ''}, ${formatBytes(att?.size)}`}
        >
          <View style={[styles.docIcon, { backgroundColor: visual.color }]}>
            <Ionicons name={visual.icon} size={sz(20)} color="#FFF" />
          </View>
          <View style={styles.docBody}>
            <Text style={[styles.docName, textColor]} numberOfLines={2}>{att?.name || 'Document'}</Text>
            <Text style={[styles.docMeta, isMe ? styles.docMetaMe : null]}>
              {[fileTypeLabel(att?.name, att?.mime), formatBytes(att?.size)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {uploading !== undefined ? (
            <View style={styles.docAction}>
              <ActivityIndicator size="small" color={isMe ? '#FFF' : ACCENT} />
            </View>
          ) : failed ? null : (
            <View style={styles.docAction}>
              <Ionicons name="open-outline" size={sz(18)} color={isMe ? '#FFF' : '#BDBDBD'} />
            </View>
          )}
        </Pressable>
        <View style={[styles.textBlock, !caption && styles.docFooter]}>
          {!!caption && (
            <LinkifiedText text={caption} style={[styles.messageText, textColor]} linkStyle={linkColor}>
              <MetaSpacer message={message} clock={clock} isMe={isMe} />
            </LinkifiedText>
          )}
          <Meta message={message} clock={clock} isMe={isMe} send={send} />
        </View>
      </>
    );
  } else {
    body = (
      <View style={styles.textBlock}>
        <LinkifiedText text={message.content} style={[styles.messageText, textColor]} linkStyle={linkColor}>
          <MetaSpacer message={message} clock={clock} isMe={isMe} />
        </LinkifiedText>
        <Meta message={message} clock={clock} isMe={isMe} send={send} />
      </View>
    );
  }

  return (
    <SwipeToReply enabled={!deleted && !pending} onReply={() => onReply(message)}>
      <View style={[styles.row, isMe ? styles.rowRight : styles.rowLeft, firstInGroup && styles.groupStart]}>
        {!isMe && (
          <View style={styles.avatarSlot}>
            {lastInGroup && <Avatar uri={chatAvatar} name={chatName} size={sz(30)} />}
          </View>
        )}

        <View style={[styles.content, isMe ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
          <Pressable
            onLongPress={() => onLongPress(message)}
            delayLongPress={300}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            style={[
              styles.bubble,
              isMe ? styles.bubbleMe : styles.bubbleThem,
              isVisualMedia && styles.bubbleMedia,
              // Flatten the corner that faces the next bubble in the same run.
              isMe
                ? [!firstInGroup && { borderTopRightRadius: sz(6) }, !lastInGroup && { borderBottomRightRadius: sz(6) }]
                : [!firstInGroup && { borderTopLeftRadius: sz(6) }, !lastInGroup && { borderBottomLeftRadius: sz(6) }],
              pending && !failed && kind === 'text' && { opacity: 0.75 },
              failed && styles.bubbleFailed,
              highlighted && styles.bubbleHighlighted,
            ]}
            accessibilityHint="Long press for reactions and options"
          >
            {message.forwarded && !deleted && (
              <View style={[styles.forwarded, isVisualMedia && styles.forwardedOnMedia]}>
                <Ionicons name="arrow-redo" size={sz(12)} color={isMe ? 'rgba(255,255,255,0.8)' : '#9A9A9A'} />
                <Text style={[styles.forwardedText, isMe && { color: 'rgba(255,255,255,0.8)' }]}>Forwarded</Text>
              </View>
            )}
            {message.reply_to && !deleted && (
              <View style={isVisualMedia ? styles.quoteOnMedia : undefined}>
                <Quote message={message} isMe={isMe} myId={myId} chatName={chatName} onPress={onQuotePress} />
              </View>
            )}
            {body}
            {/* Web's stand-in for long-press. Always mounted and only faded in:
                moving the pointer onto it fires the bubble's hover-out, and an
                unmounted button would miss the click. */}
            {Platform.OS === 'web' && !pending && (
              <Pressable
                onPress={() => onLongPress(message)}
                onHoverIn={() => setHovered(true)}
                onHoverOut={() => setHovered(false)}
                style={[styles.hoverMenu, isMe ? styles.hoverMenuMe : styles.hoverMenuThem, { opacity: hovered ? 1 : 0 }]}
                accessibilityRole="button"
                accessibilityLabel="Message options"
              >
                <Ionicons name="chevron-down" size={sz(16)} color="#FFF" />
              </Pressable>
            )}
          </Pressable>

          {reactions.length > 0 && (
            <Pressable
              onPress={() => onReactionPress(message)}
              style={[styles.reactions, isMe ? { marginRight: sz(8) } : { marginLeft: sz(8) }]}
              accessibilityRole="button"
              accessibilityLabel={`Reactions: ${reactions.map((r) => r.emoji).join(' ')}`}
            >
              {Object.keys(reactionGroups).map((emoji) => (
                <Text key={emoji} style={styles.reactionEmoji}>{emoji}</Text>
              ))}
              {reactions.length > 1 && <Text style={styles.reactionCount}>{reactions.length}</Text>}
            </Pressable>
          )}

          {failed && kind === 'text' && (
            <Pressable
              onPress={() => message.client_msg_id && onRetry(message.client_msg_id)}
              hitSlop={8}
              accessibilityRole="button"
              style={styles.failedRow}
            >
              <MaterialIcons name="error" size={sz(13)} color="#FF6B6B" />
              <Text style={styles.failedText}>{send?.error ? `${send.error}. ` : 'Not sent. '}Tap to retry</Text>
            </Pressable>
          )}
          {failed && kind !== 'text' && send?.error && (
            <Text style={[styles.failedText, styles.failedRow]}>{send.error}</Text>
          )}
        </View>
      </View>
    </SwipeToReply>
  );
}

export const MessageBubble = memo(MessageBubbleImpl, (a, b) =>
  a.message === b.message
  && a.send === b.send
  && a.highlighted === b.highlighted
  && a.isMe === b.isMe
  && a.firstInGroup === b.firstInGroup
  && a.lastInGroup === b.lastInGroup
  && a.chatName === b.chatName
  && a.chatAvatar === b.chatAvatar
  && a.myId === b.myId);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', marginTop: sz(3) },
  groupStart: { marginTop: sz(10) },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  avatarSlot: { width: sz(30), marginRight: sz(8), marginBottom: sz(2) },
  content: { maxWidth: '80%' },
  bubble: { borderRadius: sz(18), overflow: 'hidden' },
  bubbleThem: { backgroundColor: '#262626' },
  bubbleMe: { backgroundColor: ACCENT },
  bubbleMedia: { padding: sz(3) },
  bubbleFailed: { backgroundColor: '#5A2A1E' },
  bubbleHighlighted: { borderWidth: 2, borderColor: '#FFD9C7' },
  textBlock: { paddingHorizontal: sz(12), paddingTop: sz(7), paddingBottom: sz(7) },
  messageText: { fontSize: sz(15), lineHeight: sz(21) },
  textThem: { color: '#F2F2F2' },
  textMe: { color: '#FFF' },
  italic: { fontStyle: 'italic' },
  deletedText: { fontStyle: 'italic', color: 'rgba(255,255,255,0.72)' },
  spacer: { color: 'transparent' },
  meta: {
    position: 'absolute', right: sz(10), bottom: sz(5),
    flexDirection: 'row', alignItems: 'center', gap: sz(3),
  },
  metaOnMedia: {
    right: sz(8), bottom: sz(8), paddingHorizontal: sz(6), paddingVertical: sz(2),
    borderRadius: sz(10), backgroundColor: 'rgba(0,0,0,0.45)',
  },
  metaText: { fontSize: sz(11), fontVariant: ['tabular-nums'] },
  media: { borderRadius: sz(15), overflow: 'hidden', backgroundColor: '#1A1A1A' },
  mediaImage: { borderRadius: sz(15) },
  videoTile: { backgroundColor: '#0E0E0E', justifyContent: 'center', alignItems: 'center' },
  playCircle: {
    width: sz(54), height: sz(54), borderRadius: sz(27), backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.75)', justifyContent: 'center', alignItems: 'center',
  },
  videoBadge: {
    position: 'absolute', left: sz(8), bottom: sz(8), flexDirection: 'row', alignItems: 'center', gap: sz(4),
    paddingHorizontal: sz(6), paddingVertical: sz(2), borderRadius: sz(10), backgroundColor: 'rgba(0,0,0,0.45)',
  },
  videoBadgeText: { color: '#FFF', fontSize: sz(11), fontVariant: ['tabular-nums'] },
  mediaOverlay: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center', gap: sz(6),
  },
  overlayButton: {
    width: sz(48), height: sz(48), borderRadius: sz(24), backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center',
  },
  overlayDiscard: {
    position: 'absolute', top: sz(8), right: sz(8), width: sz(28), height: sz(28), borderRadius: sz(14),
    backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center',
  },
  overlayText: { color: '#FFF', fontSize: sz(12), fontWeight: '700', fontVariant: ['tabular-nums'] },
  audioBlock: { paddingHorizontal: sz(10), paddingTop: sz(8), paddingBottom: sz(20) },
  doc: {
    flexDirection: 'row', alignItems: 'center', gap: sz(10), margin: sz(4), marginBottom: 0,
    padding: sz(10), borderRadius: sz(14), minWidth: sz(220),
  },
  docMe: { backgroundColor: 'rgba(0,0,0,0.14)' },
  docThem: { backgroundColor: 'rgba(255,255,255,0.06)' },
  docIcon: { width: sz(40), height: sz(40), borderRadius: sz(10), justifyContent: 'center', alignItems: 'center' },
  docBody: { flex: 1, minWidth: 0 },
  docName: { fontSize: sz(14), fontWeight: '600', lineHeight: sz(19) },
  docMeta: { fontSize: sz(12), color: '#9A9A9A', marginTop: sz(2) },
  docMetaMe: { color: 'rgba(255,255,255,0.8)' },
  docAction: { width: sz(28), alignItems: 'center' },
  docFooter: { minHeight: sz(26), paddingTop: 0, paddingBottom: 0 },
  forwarded: { flexDirection: 'row', alignItems: 'center', gap: sz(4), paddingHorizontal: sz(12), paddingTop: sz(7) },
  forwardedOnMedia: { paddingHorizontal: sz(8), paddingTop: sz(4), paddingBottom: sz(4) },
  forwardedText: { fontSize: sz(12), fontStyle: 'italic', color: '#9A9A9A' },
  quote: {
    flexDirection: 'row', margin: sz(4), marginBottom: 0, borderRadius: sz(12), overflow: 'hidden', minHeight: sz(44),
  },
  quoteMe: { backgroundColor: 'rgba(0,0,0,0.16)' },
  quoteThem: { backgroundColor: 'rgba(255,255,255,0.07)' },
  quoteOnMedia: { marginBottom: sz(3) },
  quoteBar: { width: sz(4) },
  quoteBody: { flex: 1, paddingHorizontal: sz(9), paddingVertical: sz(6) },
  quoteName: { fontSize: sz(13), fontWeight: '700' },
  quoteText: { fontSize: sz(13), lineHeight: sz(18), color: 'rgba(255,255,255,0.78)', marginTop: 1 },
  quoteThumb: { width: sz(48), height: '100%', minHeight: sz(44) },
  reactions: {
    flexDirection: 'row', alignItems: 'center', gap: sz(2), marginTop: sz(-6),
    paddingHorizontal: sz(7), paddingVertical: sz(2), borderRadius: sz(12),
    backgroundColor: '#1F1F1F', borderWidth: 1.5, borderColor: '#121212',
  },
  reactionEmoji: { fontSize: sz(14) },
  reactionCount: { fontSize: sz(12), color: '#BDBDBD', marginLeft: sz(2), fontVariant: ['tabular-nums'] },
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: sz(4), marginTop: sz(4), marginHorizontal: sz(6) },
  failedText: { fontSize: sz(11), color: '#FF6B6B', fontWeight: '600' },
  swipeIcon: {
    position: 'absolute', left: sz(4), top: '50%', marginTop: sz(-15),
    width: sz(30), height: sz(30), borderRadius: sz(15), backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  hoverMenu: {
    position: 'absolute', top: sz(4), width: sz(24), height: sz(24), borderRadius: sz(12),
    justifyContent: 'center', alignItems: 'center',
  },
  hoverMenuMe: { right: sz(4), backgroundColor: 'rgba(0,0,0,0.25)' },
  hoverMenuThem: { right: sz(4), backgroundColor: 'rgba(255,255,255,0.12)' },
});
