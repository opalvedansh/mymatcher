import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  Keyboard,
  Pressable,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { getMatches } from '@/api';
import { socketService } from '@/api/socket';
import type { ChatMessage, MatchRecord } from '@/api/types';
import { useAuth } from '@/contexts/AuthContext';
import { describeMessage } from '@/features/chat/format';
import { ConversationScreen } from '@/screens/main/shared/ConversationScreen';
import { Avatar } from '@/components/ChatAvatar';
import { formatListTime } from '@/utils/relativeTime';
import { NotificationBell } from '@/components/NotificationBell';
import { sz, tabBarClearance } from '@/theme/scale';

const ACCENT = '#FF6B2B';

interface ChatScreenProps {
  onConversationStateChange?: (isOpen: boolean) => void;
  /** Opens this conversation once the list has loaded (from a notification). */
  initialMatchId?: string;
  onInitialMatchOpened?: () => void;
}

const webNoOutline = Platform.select({ web: { outlineStyle: 'none' } as any, default: undefined });

const KIND_LABEL: Record<string, string> = { image: 'Photo', video: 'Video', audio: 'Voice message', document: 'Document' };

/** The chat-list preview fields for a message that just arrived or changed. */
function previewFields(msg: ChatMessage): Partial<MatchRecord> {
  const kind = msg.kind ?? 'text';
  return {
    last_message: msg.deleted_at ? '' : msg.content,
    last_message_at: msg.created_at,
    last_message_sender: msg.sender_id,
    last_message_read_at: msg.read_at ?? undefined,
    last_message_delivered_at: msg.delivered_at ?? null,
    last_message_kind: kind,
    last_message_label: kind === 'document' ? msg.attachment?.name || 'Document' : KIND_LABEL[kind] ?? null,
    last_message_duration_ms: msg.attachment?.duration_ms ?? null,
    last_message_deleted_at: msg.deleted_at ?? null,
  };
}

function previewText(m: MatchRecord, sentByMe: boolean) {
  if (m.last_message_deleted_at) return sentByMe ? 'You deleted this message' : 'This message was deleted';
  return describeMessage(m.last_message_kind, m.last_message || '', { label: m.last_message_label, duration_ms: m.last_message_duration_ms });
}

export function ChatScreen({ onConversationStateChange, initialMatchId, onInitialMatchOpened }: ChatScreenProps) {
  const { onboardingData, user } = useAuth();
  const role = onboardingData?.role?.toLowerCase() as 'brand' | 'influencer' | undefined;

  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedMatch, setSelectedMatch] = useState<MatchRecord | null>(null);
  const hasLoaded = useRef(false);
  const selectedRef = useRef<MatchRecord | null>(null);
  selectedRef.current = selectedMatch;

  useEffect(() => {
    onConversationStateChange?.(!!selectedMatch);
  }, [selectedMatch, onConversationStateChange]);

  // Put the tab bar back if the screen goes away with a chat open.
  useEffect(() => () => onConversationStateChange?.(false), [onConversationStateChange]);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const res = await getMatches() as any;
      const list: MatchRecord[] = Array.isArray(res) ? res : (res?.data || []);
      list.sort((a, b) =>
        new Date(b.last_message_at || b.matched_at).getTime() - new Date(a.last_message_at || a.matched_at).getTime(),
      );
      setMatches(list);
      setError(false);
      hasLoaded.current = true;
    } catch (e) {
      console.warn('Failed to load chats', e);
      if (mode !== 'silent') setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refresh quietly when coming back from a conversation so read state and previews update.
  useEffect(() => {
    if (selectedMatch) return;
    load(hasLoaded.current ? 'silent' : 'initial');
  }, [selectedMatch, load]);

  // Live list: new messages move their chat to the top, receipts update ticks.
  useEffect(() => {
    const myId = user?.id;
    const offs = [
      socketService.on('receive_message', (msg) => {
        if (!msg.match_id) return;
        setMatches((prev) => {
          const i = prev.findIndex((m) => m.match_id === msg.match_id);
          if (i < 0) {
            // A chat this list does not have yet (a brand-new match).
            load('silent');
            return prev;
          }
          const m = prev[i];
          const unseen = msg.sender_id !== myId && selectedRef.current?.match_id !== msg.match_id;
          const updated = { ...m, ...previewFields(msg), unread_count: unseen ? (m.unread_count ?? 0) + 1 : m.unread_count };
          return [updated, ...prev.slice(0, i), ...prev.slice(i + 1)];
        });
      }),
      socketService.on('message_updated', (msg) => {
        // Only the preview's own message matters here (edited or deleted).
        setMatches((prev) => prev.map((m) => (m.match_id === msg.match_id && m.last_message_at === msg.created_at && m.last_message_sender === msg.sender_id
          ? { ...m, ...previewFields(msg) }
          : m)));
      }),
      socketService.on('messages_read', ({ matchId, readerId, at }) => {
        setMatches((prev) => prev.map((m) => {
          if (m.match_id !== matchId) return m;
          if (readerId === myId) return { ...m, unread_count: 0, last_message_read_at: m.last_message_sender !== myId ? at : m.last_message_read_at };
          return m.last_message_sender === myId ? { ...m, last_message_read_at: at } : m;
        }));
      }),
      socketService.on('messages_delivered', ({ matchId, at }) => {
        setMatches((prev) => prev.map((m) => (m.match_id === matchId && m.last_message_sender === myId && !m.last_message_delivered_at
          ? { ...m, last_message_delivered_at: at }
          : m)));
      }),
      socketService.on('chat_cleared', () => load('silent')),
      socketService.on('messages_hidden', () => load('silent')),
    ];
    return () => offs.forEach((off) => off());
  }, [user?.id, load]);

  // Open the chat a notification pointed at, once it is in the loaded list.
  const reloadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!initialMatchId || loading) return;
    const target = matches.find(m => m.match_id === initialMatchId);
    if (!target && reloadedFor.current !== initialMatchId) {
      // The match may be newer than the list we have; fetch once more before giving up.
      reloadedFor.current = initialMatchId;
      load('silent');
      return;
    }
    if (target) setSelectedMatch(target);
    onInitialMatchOpened?.();
  }, [initialMatchId, loading, matches, onInitialMatchOpened, load]);

  const getMatchPerson = (m: MatchRecord) => {
    if (role === 'brand') {
      return { userId: m.influencer_id, name: m.influencer_name, avatar: m.influencer_avatar, verified: m.influencer_verified, myAvatar: m.brand_logo };
    }
    return { userId: m.brand_id, name: m.brand_name, avatar: m.brand_logo, verified: m.brand_verified, myAvatar: m.influencer_avatar };
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return matches;
    return matches.filter((m) => {
      const person = getMatchPerson(m);
      return (person.name || '').toLowerCase().includes(q)
        || (m.last_message || '').toLowerCase().includes(q)
        || (m.last_message_label || '').toLowerCase().includes(q);
    });
    // getMatchPerson only depends on role
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, query, role]);

  // Stable identity matters here: the search box's `query` lives in this
  // component, so a fresh renderItem on each keystroke would re-render every
  // visible chat row while the user types.
  const renderItem = useCallback(({ item }: { item: MatchRecord }) => {
    const person = getMatchPerson(item);
    const name = person.name || 'Unknown';
    const sentByMe = !!item.last_message_sender && item.last_message_sender === user?.id;
    // Only messages from the other person can be unread for me.
    const unreadCount = item.unread_count ?? (item.last_message_sender && !sentByMe && !item.last_message_read_at ? 1 : 0);
    const unread = unreadCount > 0;
    const isNewMatch = !item.last_message_at;
    const muted = !!item.muted_until && new Date(item.muted_until) > new Date();
    const ticks = sentByMe && !item.last_message_deleted_at
      ? item.last_message_read_at ? 'read' : item.last_message_delivered_at ? 'delivered' : 'sent'
      : null;

    return (
      <Pressable
        style={({ pressed }) => [styles.chatItem, pressed && styles.chatItemPressed]}
        onPress={() => setSelectedMatch(item)}
        accessibilityRole="button"
        accessibilityLabel={`${name}${unread ? `, ${unreadCount} unread` : ''}`}
      >
        <View>
          <Avatar uri={person.avatar} name={name} size={sz(56)} />
          {isNewMatch && <View style={styles.newMatchRing} pointerEvents="none" />}
        </View>

        <View style={styles.chatDetails}>
          <View style={styles.nameRow}>
            <Text style={[styles.chatName, unread && styles.chatNameUnread]} numberOfLines={1}>{name}</Text>
            {person.verified && <MaterialIcons name="verified" size={sz(15)} color={ACCENT} style={{ marginLeft: sz(4) }} />}
          </View>
          {isNewMatch ? (
            <Text style={styles.newMatchText} numberOfLines={1}>New match. Say hello.</Text>
          ) : (
            <View style={styles.previewRow}>
              {ticks && (
                <Ionicons
                  name={ticks === 'sent' ? 'checkmark' : 'checkmark-done'}
                  size={sz(16)}
                  color={ticks === 'read' ? '#53BDEB' : '#8A8A8A'}
                  style={{ marginRight: sz(3) }}
                  accessibilityLabel={ticks === 'read' ? 'Read' : ticks === 'delivered' ? 'Delivered' : 'Sent'}
                />
              )}
              <Text
                style={[styles.chatMessage, unread && styles.chatMessageUnread, !!item.last_message_deleted_at && styles.italic]}
                numberOfLines={1}
              >
                {previewText(item, sentByMe)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.chatMeta}>
          <Text style={[styles.chatTime, unread && !muted && { color: ACCENT }]}>
            {formatListTime(item.last_message_at || item.matched_at)}
          </Text>
          <View style={styles.badgeRow}>
            {muted && <Ionicons name="notifications-off" size={sz(14)} color="#6E6E6E" accessibilityLabel="Muted" />}
            {unread && (
              <View style={[styles.unreadBadge, muted && styles.unreadBadgeMuted]} accessibilityLabel={`${unreadCount} unread`}>
                <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    );
    // getMatchPerson only depends on role, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, user?.id]);

  const keyExtractor = useCallback((item: MatchRecord) => item.match_id, []);

  const renderSeparator = useCallback(() => <View style={styles.separator} />, []);

  if (selectedMatch) {
    const person = getMatchPerson(selectedMatch);
    return (
      <ConversationScreen
        matchId={selectedMatch.match_id}
        otherUserId={person.userId}
        chatName={person.name ?? 'Chat'}
        chatAvatar={person.avatar ?? undefined}
        chatVerified={!!person.verified}
        matchedAt={selectedMatch.matched_at}
        onBack={() => setSelectedMatch(null)}
      />
    );
  }

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={styles.listContent} accessibilityLabel="Loading chats">
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.chatItem}>
            <View style={[styles.skeleton, { width: sz(56), height: sz(56), borderRadius: sz(28) }]} />
            <View style={styles.chatDetails}>
              <View style={[styles.skeleton, { width: '45%', height: sz(14) }]} />
              <View style={[styles.skeleton, { width: '75%', height: sz(12), marginTop: sz(10) }]} />
            </View>
          </View>
        ))}
      </View>
    );
  } else if (error) {
    body = (
      <View style={styles.stateBox}>
        <View style={styles.stateIcon}><Ionicons name="cloud-offline-outline" size={sz(26)} color="#BDBDBD" /></View>
        <Text style={styles.stateTitle}>Couldn't load your chats</Text>
        <Text style={styles.stateBody}>Check your connection and try again.</Text>
        <Pressable onPress={() => load('initial')} accessibilityRole="button" style={({ pressed }) => [styles.stateButton, pressed && styles.pressed]}>
          <Text style={styles.stateButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  } else if (matches.length === 0) {
    body = (
      <View style={styles.stateBox}>
        <View style={styles.stateIcon}><Ionicons name="chatbubbles-outline" size={sz(26)} color={ACCENT} /></View>
        <Text style={styles.stateTitle}>No conversations yet</Text>
        <Text style={styles.stateBody}>
          {role === 'brand' ? 'When you match with a creator, you can chat here.' : 'When you match with a brand, you can chat here.'}
        </Text>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={filtered}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ItemSeparatorComponent={renderSeparator}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={ACCENT} colors={[ACCENT]} />
        }
        ListEmptyComponent={
          <Text style={styles.noResults}>No chats match "{query.trim()}"</Text>
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">Chat</Text>
        <NotificationBell />
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={sz(18)} color="#8A8A8A" />
          <TextInput
            style={[styles.searchInput, webNoOutline]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search chats"
            placeholderTextColor="#8A8A8A"
            returnKeyType="search"
            onSubmitEditing={Keyboard.dismiss}
            autoCorrect={false}
            accessibilityLabel="Search chats"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={sz(18)} color="#8A8A8A" />
            </Pressable>
          )}
        </View>
      </View>

      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#121212' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: sz(24),
    marginTop: sz(20),
    marginBottom: sz(20),
  },
  headerTitle: { fontSize: sz(34), fontWeight: 'bold', color: '#FFF', letterSpacing: -0.5 },
  searchContainer: { paddingHorizontal: sz(24), marginBottom: sz(12) },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(10),
    height: sz(46),
    paddingHorizontal: sz(16),
    borderRadius: sz(23),
    backgroundColor: '#1E1E1E',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  searchInput: { flex: 1, fontSize: sz(16), color: '#FFF', paddingVertical: 0 },
  listContent: { paddingHorizontal: sz(12), paddingBottom: tabBarClearance(100) }, // leaves room for the tab bar
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: sz(12),
    paddingHorizontal: sz(12),
    borderRadius: sz(16),
  },
  chatItemPressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  newMatchRing: {
    position: 'absolute', top: sz(-3), left: sz(-3), right: sz(-3), bottom: sz(-3),
    borderRadius: sz(31), borderWidth: 2, borderColor: ACCENT,
  },
  chatDetails: { flex: 1, marginLeft: sz(14), marginRight: sz(12) },
  nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: sz(3) },
  chatName: { fontSize: sz(16), fontWeight: '600', color: '#FFF', flexShrink: 1 },
  chatNameUnread: { fontWeight: '700' },
  chatMessage: { fontSize: sz(14), color: '#9A9A9A', lineHeight: sz(20), flexShrink: 1 },
  previewRow: { flexDirection: 'row', alignItems: 'center' },
  italic: { fontStyle: 'italic' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: sz(6), minHeight: sz(20) },
  unreadBadge: {
    minWidth: sz(20), height: sz(20), borderRadius: sz(10), paddingHorizontal: sz(6),
    backgroundColor: ACCENT, justifyContent: 'center', alignItems: 'center',
  },
  unreadBadgeMuted: { backgroundColor: '#4A4A4A' },
  unreadBadgeText: { color: '#FFF', fontSize: sz(11), fontWeight: '700', fontVariant: ['tabular-nums'] },
  chatMessageUnread: { color: '#FFF', fontWeight: '500' },
  newMatchText: { fontSize: sz(14), color: '#FF8A55', lineHeight: sz(20), fontWeight: '500' },
  chatMeta: { alignItems: 'flex-end', gap: sz(8), minWidth: sz(36) },
  chatTime: { fontSize: sz(12), color: '#8A8A8A', fontVariant: ['tabular-nums'] },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.08)', marginLeft: sz(82), marginRight: sz(12) },
  skeleton: { backgroundColor: '#1E1E1E', borderRadius: sz(7) },
  noResults: { color: '#8A8A8A', fontSize: sz(14), textAlign: 'center', marginTop: sz(40) },
  stateBox: { alignItems: 'center', paddingTop: sz(72), paddingHorizontal: sz(40) },
  stateIcon: {
    width: sz(60), height: sz(60), borderRadius: sz(30), backgroundColor: '#1E1E1E',
    justifyContent: 'center', alignItems: 'center', marginBottom: sz(16),
  },
  stateTitle: { color: '#FFF', fontSize: sz(18), fontWeight: '700', textAlign: 'center' },
  stateBody: { color: '#9A9A9A', fontSize: sz(14), lineHeight: sz(20), textAlign: 'center', marginTop: sz(6) },
  stateButton: {
    marginTop: sz(20), borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: sz(12),
    paddingVertical: sz(11), paddingHorizontal: sz(24),
  },
  stateButtonText: { color: '#FFF', fontSize: sz(15), fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
