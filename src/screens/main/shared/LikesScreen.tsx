import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { getMatches, getLikesReceived } from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { NotificationBell } from '@/components/NotificationBell';
import { sz, tabBarClearance } from '@/theme/scale';

const GRID_SPACING = sz(16);
// The tab bar covers the bottom safe area and tabBarClearance already adds
// it to the list padding, so the bottom edge is left out here.
const SAFE_EDGES: Edge[] = ['top', 'left', 'right'];
// Placeholder cards shown blurred when there is nothing to show yet.
const DUMMIES = [1, 2, 3, 4];

type MixedRecord = {
  id: string;
  type: 'match' | 'like';
  /** The other person, whose profile the card opens. */
  userId?: string;
  name?: string;
  avatar?: string;
  verified?: boolean;
  location?: string;
  niche?: string;
  followers?: number;
  engagement?: number;
  views?: number;
  workedWith?: string[];
};

type GridItem = MixedRecord | number;

const formatNum = (num: number) => {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(0)}k`;
  return String(num || 0);
};

const keyExtractor = (item: GridItem) => (typeof item === 'number' ? `dummy-${item}` : item.id);

export function LikesScreen() {
  const { width } = useWindowDimensions();
  const { onboardingData, user } = useAuth();
  const router = useRouter();
  const role = onboardingData?.role?.toLowerCase() as 'brand' | 'influencer' | undefined;

  const [items, setItems] = useState<MixedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Newest request wins; an older one finishing late is ignored.
  const loadSeqRef = useRef(0);
  const loadedRef = useRef(false);

  const ITEM_WIDTH = (width - sz(24) * 2 - GRID_SPACING) / 2;
  const isPremium = user?.email === 'vedanshlovesmom88@gmail.com';

  // initial: spinner. refresh: pull-to-refresh. silent: coming back to the
  // tab, updated in place without a spinner.
  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    const seq = ++loadSeqRef.current;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const [matchesRes, likesRes] = await Promise.all([
        getMatches().catch(() => ({ data: [] })),
        getLikesReceived().catch(() => ({ data: [] }))
      ]) as any[];

      const matchesData = matchesRes?.data || matchesRes || [];
      const likesData = likesRes?.data || likesRes || [];

      const formattedMatches: MixedRecord[] = matchesData.map((m: any) => ({
        id: m.match_id,
        type: 'match',
        userId: role === 'brand' ? m.influencer_id : m.brand_id,
        ...(role === 'brand'
          ? {
              name: m.influencer_name, avatar: m.influencer_avatar, verified: m.influencer_verified, location: m.influencer_location,
              niche: (m.influencer_categories || []).join(' · '), followers: m.followers, engagement: m.engagement_rate, views: m.avg_views,
            }
          : {
              name: m.brand_name, avatar: m.brand_logo, verified: m.brand_verified, location: m.brand_location,
              niche: (m.brand_categories || []).join(' · ')
            })
      }));

      const formattedLikes: MixedRecord[] = likesData.map((l: any) => ({
        id: l.swipe_id,
        type: 'like',
        userId: l.user_id,
        ...(role === 'brand'
          ? {
              name: l.influencer_name, avatar: l.influencer_avatar, verified: l.influencer_verified, location: l.influencer_location,
              niche: (l.influencer_categories || []).join(' · '), followers: l.followers, engagement: l.engagement_rate, views: l.avg_views,
            }
          : {
              name: l.brand_name, avatar: l.brand_logo, verified: l.brand_verified, location: l.brand_location,
              niche: (l.brand_categories || []).join(' · ')
            })
      }));

      if (seq !== loadSeqRef.current) return;
      setItems([...formattedMatches, ...formattedLikes]);
      setError(null);
      loadedRef.current = true;
    } catch (e: any) {
      // A failed background refresh keeps what is already on screen.
      if (seq === loadSeqRef.current && !loadedRef.current) setError(e.message ?? 'Failed to load likes');
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [role]);

  // New likes arrive while the user is on other tabs, so refetch on every
  // return. `load` changes with the role, which reloads too.
  useFocusEffect(
    useCallback(() => {
      load(loadedRef.current ? 'silent' : 'initial');
    }, [load]),
  );

  // A brand only ever sees creators here, and a creator only brands. A matched
  // card passes its match so the profile offers Message instead of Interested.
  const openProfile = useCallback((record: MixedRecord) => {
    if (!record.userId) return;
    router.push({
      pathname: '/profile/[id]',
      params: {
        id: record.userId,
        role: role === 'brand' ? 'influencer' : 'brand',
        ...(record.type === 'match' ? { matchId: record.id } : {}),
      },
    });
  }, [router, role]);

  const renderItem = useCallback(({ item, index }: { item: GridItem; index: number }) => {
    const isDummy = typeof item === 'number';
    const record = isDummy ? null : item;
    // Placeholders are always blurred, so a small image looks the same and
    // costs far less to blur.
    const imageUrl = record?.avatar || `https://picsum.photos/seed/${index + 10}/200/310`;

    // Blur if dummy, OR if it's a 'like' and user doesn't have premium
    const shouldBlur = isDummy || (!isPremium && record?.type === 'like');
    // A blurred card stays shut: opening it would show who is behind the blur.
    const canOpen = !shouldBlur && !!record?.userId;

    return (
      <Pressable
        onPress={canOpen ? () => openProfile(record) : undefined}
        disabled={!canOpen}
        accessibilityRole={canOpen ? 'button' : undefined}
        accessibilityLabel={canOpen ? (record.name ? `Open ${record.name}'s profile` : 'Open profile') : undefined}
        style={({ pressed }) => [
          styles.gridItem,
          { width: ITEM_WIDTH, height: ITEM_WIDTH * 1.55 },
          pressed && styles.cardPressed,
        ]}
      >
        <Image
          source={{ uri: imageUrl }}
          style={styles.matchImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={keyExtractor(item)}
          blurRadius={shouldBlur ? 20 : 0}
        />

        {!shouldBlur && record && (
          <>
            <LinearGradient
              colors={['rgba(0,0,0,0.0)', 'rgba(14,14,14,0.8)', 'rgba(14,14,14,1)']}
              style={styles.bottomFade}
            />
            <View style={styles.infoPanel}>
              <Text style={styles.infoName} numberOfLines={1}>{record.name}</Text>
              <Text style={styles.infoCats} numberOfLines={1}>{record.niche || 'Creator'}</Text>
              <View style={styles.locationRow}>
                <Ionicons name="location-sharp" size={sz(10)} color="#aaa" />
                <Text style={styles.locationTxt} numberOfLines={1}>{record.location}</Text>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statCol}>
                  <Text style={styles.statVal}>{formatNum(record.followers || 0)}</Text>
                  <Text style={styles.statLbl}>Flwrs</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statCol}>
                  <Text style={styles.statVal}>{record.engagement || 0}%</Text>
                  <Text style={styles.statLbl}>Eng</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statCol}>
                  <Text style={styles.statVal}>{formatNum(record.views || 0)}</Text>
                  <Text style={styles.statLbl}>Views</Text>
                </View>
              </View>
            </View>
          </>
        )}
      </Pressable>
    );
  }, [ITEM_WIDTH, isPremium, openProfile]);

  const ready = !loading && !error;

  const listHeader = (
    <>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Likes</Text>
        <NotificationBell />
      </View>

      {ready && (
        /* Premium Banner */
        <View style={styles.premiumBanner}>
          <View style={styles.heartCircle}>
            <Ionicons name="heart" size={sz(24)} color="#FF6B2B" />
          </View>
          <Text style={styles.premiumTitle}>View your likes</Text>
          <Text style={styles.premiumSubtitle}>
            Activate Matchr Premium and see the people whose likes you already have.
          </Text>
          <Pressable style={styles.premiumBtn}>
            <Text style={styles.premiumBtnText}>Activate Premium</Text>
          </Pressable>
        </View>
      )}
    </>
  );

  const listEmpty = loading ? (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color="#FF6B2B" />
      <Text style={styles.loadingTxt}>Loading your likes...</Text>
    </View>
  ) : error ? (
    <View style={styles.centered}>
      <Text style={[styles.emptyTitle, { color: '#FF3B30' }]}>⚠️ {error}</Text>
    </View>
  ) : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={SAFE_EDGES}>
      <FlatList<GridItem>
        data={ready ? (items.length > 0 ? items : DUMMIES) : []}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={() => load('refresh')}
        // Each card is a tall photo; mount a few screens' worth, not all.
        initialNumToRender={6}
        windowSize={5}
        removeClippedSubviews
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#121212' },
  scrollContent: { paddingBottom: tabBarClearance(100) },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: sz(24), marginTop: sz(20), marginBottom: sz(16),
  },
  headerTitle: { fontSize: sz(34), fontWeight: 'bold', color: '#FFF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: sz(80), paddingHorizontal: sz(32) },
  loadingTxt: { color: '#888', marginTop: sz(12), fontSize: sz(14) },
  emptyTitle: { fontSize: sz(22), fontWeight: '700', color: '#FFF', textAlign: 'center' },
  emptySub: { fontSize: sz(14), color: '#888', textAlign: 'center', marginTop: sz(10), lineHeight: sz(21) },
  countLabel: { color: '#888', fontSize: sz(13), paddingHorizontal: sz(24), marginBottom: sz(12), textTransform: 'uppercase', letterSpacing: 0.8 },
  premiumBanner: { alignItems: 'center', paddingHorizontal: sz(32), marginTop: sz(10), marginBottom: sz(30) },
  heartCircle: { width: sz(56), height: sz(56), borderRadius: sz(28), backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', marginBottom: sz(16) },
  premiumTitle: { color: '#FFF', fontSize: sz(20), fontWeight: '700', marginBottom: sz(10) },
  premiumSubtitle: { color: '#FFF', fontSize: sz(14), textAlign: 'center', lineHeight: sz(20), marginBottom: sz(20) },
  premiumBtn: { backgroundColor: '#FFF', paddingVertical: sz(12), paddingHorizontal: sz(24), borderRadius: sz(24) },
  premiumBtnText: { color: '#000', fontSize: sz(14), fontWeight: '700' },
  gridRow: { paddingHorizontal: sz(24), justifyContent: 'space-between', marginBottom: GRID_SPACING },
  gridItem: { borderRadius: sz(12), overflow: 'hidden', backgroundColor: '#222', justifyContent: 'flex-end' },
  cardPressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  matchImage: { position: 'absolute', width: '100%', height: '100%' },
  avatarPlaceholder: { backgroundColor: '#2A2A2A', justifyContent: 'center', alignItems: 'center' },
  avatarInitial: { fontSize: sz(40), fontWeight: '700', color: '#FF6B2B' },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '70%' },
  infoPanel: { paddingHorizontal: sz(12), paddingBottom: sz(14), backgroundColor: 'transparent' },
  infoName: { color: '#fff', fontSize: sz(16), fontWeight: '800' },
  infoCats: { color: 'rgba(255,255,255,0.8)', fontSize: sz(11), marginTop: sz(2) },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginTop: sz(4), gap: sz(4) },
  locationTxt: { color: '#ccc', fontSize: sz(10) },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: sz(12), paddingTop: sz(10), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.2)' },
  statCol: { alignItems: 'center', flex: 1 },
  statVal: { color: '#fff', fontSize: sz(12), fontWeight: '800' },
  statLbl: { color: '#aaa', fontSize: sz(9), marginTop: sz(2), textAlign: 'center', textTransform: 'uppercase' },
  statDivider: { width: StyleSheet.hairlineWidth, height: sz(20), backgroundColor: 'rgba(255,255,255,0.2)' },
});
