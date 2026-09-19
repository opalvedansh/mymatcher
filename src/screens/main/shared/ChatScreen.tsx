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
import type { MatchRecord } from '@/api/types';
import { useAuth } from '@/contexts/AuthContext';
import { ConversationScreen } from '@/screens/main/shared/ConversationScreen';
import { Avatar } from '@/components/ChatAvatar';
import { formatListTime } from '@/utils/relativeTime';
import { NotificationBell } from '@/components/NotificationBell';

const ACCENT = '#FF6B2B';

interface ChatScreenProps {
  onConversationStateChange?: (isOpen: boolean) => void;
  /** Opens this conversation once the list has loaded (from a notification). */
  initialMatchId?: string;
  onInitialMatchOpened?: () => void;
}

const webNoOutline = Platform.select({ web: { outlineStyle: 'none' } as any, default: undefined });

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
      return (person.name || '').toLowerCase().includes(q) || (m.last_message || '').toLowerCase().includes(q);
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
    const unread = !!item.last_message_sender && !sentByMe && !item.last_message_read_at;
    const isNewMatch = !item.last_message;

    return (
      <Pressable
        style={({ pressed }) => [styles.chatItem, pressed && styles.chatItemPressed]}
        onPress={() => setSelectedMatch(item)}
        accessibilityRole="button"
        accessibilityLabel={`${name}${unread ? ', unread message' : ''}`}
      >
        <View>
          <Avatar uri={person.avatar} name={name} size={56} />
          {isNewMatch && <View style={styles.newMatchRing} pointerEvents="none" />}
        </View>

        <View style={styles.chatDetails}>
          <View style={styles.nameRow}>
            <Text style={[styles.chatName, unread && styles.chatNameUnread]} numberOfLines={1}>{name}</Text>
            {person.verified && <MaterialIcons name="verified" size={15} color={ACCENT} style={{ marginLeft: 4 }} />}
          </View>
          {isNewMatch ? (
            <Text style={styles.newMatchText} numberOfLines={1}>New match. Say hello.</Text>
          ) : (
            <Text style={[styles.chatMessage, unread && styles.chatMessageUnread]} numberOfLines={1}>
              {sentByMe ? `You: ${item.last_message}` : item.last_message}
            </Text>
          )}
        </View>

        <View style={styles.chatMeta}>
          <Text style={[styles.chatTime, unread && { color: ACCENT }]}>
            {formatListTime(item.last_message_at || item.matched_at)}
          </Text>
          {unread && <View style={styles.unreadDot} accessibilityElementsHidden />}
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
            <View style={[styles.skeleton, { width: 56, height: 56, borderRadius: 28 }]} />
            <View style={styles.chatDetails}>
              <View style={[styles.skeleton, { width: '45%', height: 14 }]} />
              <View style={[styles.skeleton, { width: '75%', height: 12, marginTop: 10 }]} />
            </View>
          </View>
        ))}
      </View>
    );
  } else if (error) {
    body = (
      <View style={styles.stateBox}>
        <View style={styles.stateIcon}><Ionicons name="cloud-offline-outline" size={26} color="#BDBDBD" /></View>
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
        <View style={styles.stateIcon}><Ionicons name="chatbubbles-outline" size={26} color={ACCENT} /></View>
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
          <Ionicons name="search" size={18} color="#8A8A8A" />
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
              <Ionicons name="close-circle" size={18} color="#8A8A8A" />
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
    paddingHorizontal: 24,
    marginTop: 20,
    marginBottom: 20,
  },
  headerTitle: { fontSize: 34, fontWeight: 'bold', color: '#FFF', letterSpacing: -0.5 },
  searchContainer: { paddingHorizontal: 24, marginBottom: 12 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    paddingHorizontal: 16,
    borderRadius: 23,
    backgroundColor: '#1E1E1E',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  searchInput: { flex: 1, fontSize: 16, color: '#FFF', paddingVertical: 0 },
  listContent: { paddingHorizontal: 12, paddingBottom: 100 }, // leaves room for the tab bar
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  chatItemPressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  newMatchRing: {
    position: 'absolute', top: -3, left: -3, right: -3, bottom: -3,
    borderRadius: 31, borderWidth: 2, borderColor: ACCENT,
  },
  chatDetails: { flex: 1, marginLeft: 14, marginRight: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  chatName: { fontSize: 16, fontWeight: '600', color: '#FFF', flexShrink: 1 },
  chatNameUnread: { fontWeight: '700' },
  chatMessage: { fontSize: 14, color: '#9A9A9A', lineHeight: 20 },
  chatMessageUnread: { color: '#FFF', fontWeight: '500' },
  newMatchText: { fontSize: 14, color: '#FF8A55', lineHeight: 20, fontWeight: '500' },
  chatMeta: { alignItems: 'flex-end', gap: 8, minWidth: 36 },
  chatTime: { fontSize: 12, color: '#8A8A8A', fontVariant: ['tabular-nums'] },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ACCENT },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.08)', marginLeft: 82, marginRight: 12 },
  skeleton: { backgroundColor: '#1E1E1E', borderRadius: 7 },
  noResults: { color: '#8A8A8A', fontSize: 14, textAlign: 'center', marginTop: 40 },
  stateBox: { alignItems: 'center', paddingTop: 72, paddingHorizontal: 40 },
  stateIcon: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: '#1E1E1E',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  stateTitle: { color: '#FFF', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  stateBody: { color: '#9A9A9A', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6 },
  stateButton: {
    marginTop: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 12,
    paddingVertical: 11, paddingHorizontal: 24,
  },
  stateButtonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
