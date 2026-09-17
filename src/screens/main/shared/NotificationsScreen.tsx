import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { getNotifications, markNotificationsRead } from '@/api';
import type { AppNotification } from '@/api/types';
import { Avatar } from '@/components/ChatAvatar';
import { useAuth } from '@/contexts/AuthContext';
import { refreshUnreadNotifications } from '@/hooks/useUnreadNotifications';
import { notificationHref } from '@/services/notificationRoutes';
import { formatListTime } from '@/utils/relativeTime';

const ACCENT = '#FF6B2B';
const PAGE_SIZE = 30;

const TYPE_ICON: Record<AppNotification['type'], React.ComponentProps<typeof Ionicons>['name']> = {
  new_match: 'people',
  new_like: 'heart',
  new_message: 'chatbubble',
};

function NotificationIcon({ item }: { item: AppNotification }) {
  // Likes are anonymous, so they get an icon instead of a face.
  if (item.type === 'new_like' || !item.actor_name) {
    return (
      <View style={styles.iconTile}>
        <Ionicons name={TYPE_ICON[item.type]} size={22} color={ACCENT} />
      </View>
    );
  }
  return (
    <View>
      <Avatar uri={item.actor_avatar} name={item.actor_name} size={48} />
      <View style={styles.typeBadge}>
        <Ionicons name={TYPE_ICON[item.type]} size={11} color="#FFF" />
      </View>
    </View>
  );
}

export function NotificationsScreen() {
  const router = useRouter();
  const { onboardingData } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const nextBefore = useRef<string | null>(null);
  const loadingMore = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    try {
      const res = await getNotifications(PAGE_SIZE);
      setItems(res.data);
      nextBefore.current = res.next_before;
      setError(false);
    } catch (e) {
      console.warn('Failed to load notifications', e);
      if (mode === 'initial') setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load('initial'); }, [load]);

  const loadMore = async () => {
    if (loadingMore.current || !nextBefore.current) return;
    loadingMore.current = true;
    try {
      const res = await getNotifications(PAGE_SIZE, nextBefore.current);
      nextBefore.current = res.next_before;
      setItems(prev => {
        const seen = new Set(prev.map(i => i.id));
        return [...prev, ...res.data.filter(i => !seen.has(i.id))];
      });
    } catch {/* the next scroll tries again */} finally {
      loadingMore.current = false;
    }
  };

  const markRead = async (ids?: string[]) => {
    const now = new Date().toISOString();
    setItems(prev => prev.map(i => (!i.read_at && (!ids || ids.includes(i.id)) ? { ...i, read_at: now } : i)));
    try {
      await markNotificationsRead(ids);
    } catch (e) {
      console.warn('Failed to mark notifications read', e);
    } finally {
      refreshUnreadNotifications();
    }
  };

  const openItem = (item: AppNotification) => {
    if (!item.read_at) markRead([item.id]);
    router.navigate(notificationHref(onboardingData?.role, item.type, item.match_id));
  };

  const hasUnread = items.some(i => !i.read_at);

  const renderItem = ({ item }: { item: AppNotification }) => {
    const unread = !item.read_at;
    return (
      <Pressable
        onPress={() => openItem(item)}
        accessibilityRole="button"
        accessibilityLabel={`${unread ? 'Unread. ' : ''}${item.title}. ${item.body}`}
        style={({ pressed }) => [styles.row, unread && styles.rowUnread, pressed && styles.rowPressed]}
      >
        <NotificationIcon item={item} />
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, unread && styles.rowTitleUnread]} numberOfLines={1}>{item.title}</Text>
          {!!item.body && <Text style={styles.rowBody} numberOfLines={2}>{item.body}</Text>}
        </View>
        <View style={styles.rowMeta}>
          <Text style={[styles.rowTime, unread && { color: ACCENT }]}>{formatListTime(item.created_at)}</Text>
          {unread && <View style={styles.unreadDot} />}
        </View>
      </Pressable>
    );
  };

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={styles.list} accessibilityLabel="Loading notifications">
        {[0, 1, 2, 3, 4].map(i => (
          <View key={i} style={styles.row}>
            <View style={[styles.skeleton, { width: 48, height: 48, borderRadius: 24 }]} />
            <View style={styles.rowText}>
              <View style={[styles.skeleton, { width: '55%', height: 14 }]} />
              <View style={[styles.skeleton, { width: '80%', height: 12, marginTop: 10 }]} />
            </View>
          </View>
        ))}
      </View>
    );
  } else if (error) {
    body = (
      <View style={styles.stateBox}>
        <View style={styles.stateIcon}><Ionicons name="cloud-offline-outline" size={26} color="#BDBDBD" /></View>
        <Text style={styles.stateTitle}>Couldn't load notifications</Text>
        <Text style={styles.stateBody}>Check your connection and try again.</Text>
        <Pressable onPress={() => load('initial')} accessibilityRole="button" style={({ pressed }) => [styles.stateButton, pressed && { opacity: 0.8 }]}>
          <Text style={styles.stateButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, items.length === 0 && { flexGrow: 1 }]}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={ACCENT} colors={[ACCENT]} />
        }
        ListEmptyComponent={
          <View style={styles.stateBox}>
            <View style={styles.stateIcon}><Ionicons name="notifications-outline" size={26} color={ACCENT} /></View>
            <Text style={styles.stateTitle}>No notifications yet</Text>
            <Text style={styles.stateBody}>New matches, likes and messages will show up here.</Text>
          </View>
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={6}
          style={styles.headerButton}
        >
          <Ionicons name="chevron-back" size={26} color="#FFF" />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">Notifications</Text>
        <Pressable
          onPress={() => markRead()}
          disabled={!hasUnread}
          accessibilityRole="button"
          hitSlop={6}
          style={({ pressed }) => [styles.markAll, !hasUnread && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.markAllText}>Mark all read</Text>
        </Pressable>
      </View>
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#121212' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, color: '#FFF', fontSize: 20, fontWeight: '700', letterSpacing: -0.3, marginLeft: 4 },
  markAll: { paddingHorizontal: 12, paddingVertical: 8 },
  markAllText: { color: ACCENT, fontSize: 14, fontWeight: '600' },
  list: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 8, paddingTop: 8, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    marginBottom: 2,
  },
  rowUnread: { backgroundColor: 'rgba(255,107,43,0.06)' },
  rowPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  iconTile: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,107,43,0.14)',
    justifyContent: 'center', alignItems: 'center',
  },
  typeBadge: {
    position: 'absolute', right: -2, bottom: -2, width: 20, height: 20, borderRadius: 10,
    backgroundColor: ACCENT, borderWidth: 2, borderColor: '#121212',
    justifyContent: 'center', alignItems: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: { color: '#E6E6E6', fontSize: 15, fontWeight: '500' },
  rowTitleUnread: { color: '#FFF', fontWeight: '700' },
  rowBody: { color: '#9A9A9A', fontSize: 13, lineHeight: 18, marginTop: 2 },
  rowMeta: { alignItems: 'flex-end', gap: 8, minWidth: 34 },
  rowTime: { color: '#8A8A8A', fontSize: 12, fontVariant: ['tabular-nums'] },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: ACCENT },
  skeleton: { backgroundColor: '#1E1E1E', borderRadius: 7 },
  stateBox: { flex: 1, alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
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
});
