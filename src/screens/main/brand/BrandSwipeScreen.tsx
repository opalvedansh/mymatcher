import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { Ionicons, FontAwesome, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getFeed, recordSwipe } from '@/api';
import type { InfluencerProfile } from '@/api/types';
import { MatchrLogo } from '@/components/MatchrLogo';
import { MatchBoomModal } from '@/components/MatchBoomModal';
import { useAuth } from '@/contexts/AuthContext';
import { NotificationBell } from '@/components/NotificationBell';

const { width } = Dimensions.get('window');
const ACCENT = '#FF6B2B';
const PAGE_SIZE = 20;
// How many upcoming card photos to pull into the cache ahead of the user.
const PREFETCH_AHEAD = 3;

/** 40000 → 40K. Never rounds a real number up into a bigger one. */
const compact = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M`
  : n >= 1000 ? `${Math.floor(n / 1000)}K`
  : String(n);

type CardItem = {
  id: string;
  image: string | null;
  name: string;
  verified: boolean;
  niche: string;
  location: string;
  contentTypes: string[];
  stats: { value: string; label: string }[];
  workedWith: string[];
};

// ─── Card Content ─────────────────────────────────────────────────
const CardContent = ({ item }: { item: CardItem }) => (
  <View style={card.wrapper}>
    {/* ── Photo Background ── */}
    {item.image ? (
      <Image
        source={{ uri: item.image }}
        style={card.photo}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={150}
        // The deck reuses this component as cards advance; without a recycling
        // key the next creator briefly shows the previous creator's photo.
        recyclingKey={item.id}
      />
    ) : (
      <View style={[card.photo, card.photoFallback]}>
        <Text style={card.fallbackInitial}>{item.name.charAt(0).toUpperCase()}</Text>
      </View>
    )}

    <LinearGradient
      colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.0)']}
      style={card.topFade}
      pointerEvents="none"
    />
    <LinearGradient
      colors={['rgba(0,0,0,0.0)', 'rgba(14,14,14,0.8)', 'rgba(14,14,14,1)']}
      style={card.bottomFade}
      pointerEvents="none"
    />

    {/* Only creators who passed verification carry the badge */}
    {item.verified && (
      <View style={card.topRight}>
        <View style={card.verifiedBadge}>
          <MaterialCommunityIcons name="check-decagram" size={15} color={ACCENT} />
          <Text style={card.verifiedTxt}>Verified</Text>
        </View>
      </View>
    )}

    {/* ── Info panel ── */}
    <View style={card.infoPanel}>
      {/* Name + niche + location */}
      <Text style={card.infoName} numberOfLines={1}>{item.name}</Text>
      {!!item.niche && <Text style={card.infoCats} numberOfLines={1}>{item.niche}</Text>}
      {!!item.location && (
        <View style={card.locationRow}>
          <Ionicons name="location-sharp" size={14} color="#aaa" />
          <Text style={card.locationTxt} numberOfLines={1}>{item.location}</Text>
        </View>
      )}

      {/* Content types */}
      {item.contentTypes.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={card.tagsScroll}
          contentContainerStyle={card.tagsContent}
        >
          <View style={[card.pill, card.pillLabel]}>
            <Text style={card.pillLabelTxt}>Creates</Text>
          </View>
          {item.contentTypes.map((t) => (
            <View key={t} style={card.pill}>
              <Text style={card.pillTxt}>{t}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Stats — only the ones this creator actually has */}
      {item.stats.length > 0 && (
        <View style={card.statsRow}>
          {item.stats.map((stat, i) => (
            <React.Fragment key={stat.label}>
              {i > 0 && <View style={card.statDivider} />}
              <View style={card.statCol}>
                <Text style={card.statVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                  {stat.value}
                </Text>
                <Text style={card.statLbl} numberOfLines={1}>{stat.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      )}

      {/* Brands the creator listed on their own profile */}
      {item.workedWith.length > 0 && (
        <View style={card.workedRow}>
          <Text style={card.workedLbl}>Worked with</Text>
          <View style={card.logosContainer}>
            {item.workedWith.slice(0, 3).map((brandName) => (
              <View key={brandName} style={card.workedChip}>
                <Text style={card.workedChipTxt} numberOfLines={1}>{brandName}</Text>
              </View>
            ))}
            {item.workedWith.length > 3 && (
              <Text style={card.workedMore}>+{item.workedWith.length - 3}</Text>
            )}
          </View>
        </View>
      )}
    </View>
  </View>
);

// ─── Main Screen ──────────────────────────────────────────────────
export function BrandSwipeScreen({ onViewProfile, onNavigateToMessages }: { onViewProfile?: (id: string) => void, onNavigateToMessages?: () => void }) {
  const { onboardingData } = useAuth();
  const [influencers, setInfluencers] = useState<InfluencerProfile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<{ name: string; avatarUrl: string | null } | null>(null);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  // The feed pages by relevance score + id, not by offset.
  const nextCursorRef = useRef<{ score: number | null; id: string | null }>({ score: null, id: null });
  const loadingMoreRef = useRef(false);

  // ── Load feed ───────────────────────────────────────────────────
  const loadFeed = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // No cursor on the first page; the server hands back the next one.
      const res = await getFeed(PAGE_SIZE);
      setInfluencers(res.data as InfluencerProfile[]);
      setCurrentIndex(0);
      nextCursorRef.current = { score: res.next_cursor_score, id: res.next_cursor_id };
    } catch (e: any) {
      setError(e.message ?? 'Failed to load influencers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  const loadMore = useCallback(async () => {
    const { score, id } = nextCursorRef.current;
    if (loadingMoreRef.current || !id) return;
    loadingMoreRef.current = true;
    try {
      const res = await getFeed(PAGE_SIZE, score ?? undefined, id);
      nextCursorRef.current = { score: res.next_cursor_score, id: res.next_cursor_id };
      const page = res.data as InfluencerProfile[];
      setInfluencers(prev => {
        const seen = new Set(prev.map(p => p.user_id));
        return [...prev, ...page.filter(p => !seen.has(p.user_id))];
      });
    } catch {/* the next swipe retries */} finally {
      loadingMoreRef.current = false;
    }
  }, []);

  // ── Swipe handler ───────────────────────────────────────────────
  const handleSwipe = useCallback(async (dir: 'left' | 'right') => {
    const profile = influencers[currentIndex];
    if (!profile) return;

    const prevIndex = currentIndex;
    setCurrentIndex(p => p + 1);
    translateX.value = 0;
    translateY.value = 0;

    try {
      if (dir === 'right') {
        const res = await recordSwipe(profile.user_id, 'like');
        if (res.matched) {
          setMatchData({
            name: profile.name ?? 'This creator',
            avatarUrl: isValidUrl(profile.avatar_url) ? (profile.avatar_url as string) : null,
          });
        }
      } else {
        await recordSwipe(profile.user_id, 'reject');
      }
    } catch (e) {
      console.warn('[API] recordSwipe failed:', e);
      setCurrentIndex(prevIndex);
      Alert.alert('Action failed', 'Could not record swipe. Restoring card.');
      return; // Do not preload next if failed
    }

    // Preload the next page as the stack runs low
    if (currentIndex >= influencers.length - 3) await loadMore();
  }, [influencers, currentIndex, translateX, translateY, loadMore]);

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      translateX.value = event.translationX;
      translateY.value = event.translationY;
    })
    .onEnd((event) => {
      const SWIPE_VELOCITY = 500;
      const SWIPE_THRESHOLD = width * 0.3;

      if (event.translationX > SWIPE_THRESHOLD || event.velocityX > SWIPE_VELOCITY) {
        translateX.value = withTiming(width + 200, { duration: 250 }, () => {
          runOnJS(handleSwipe)('right');
        });
        translateY.value = withTiming(event.translationY + (event.velocityY * 0.2), { duration: 250 });
      } else if (event.translationX < -SWIPE_THRESHOLD || event.velocityX < -SWIPE_VELOCITY) {
        translateX.value = withTiming(-width - 200, { duration: 250 }, () => {
          runOnJS(handleSwipe)('left');
        });
        translateY.value = withTiming(event.translationY + (event.velocityY * 0.2), { duration: 250 });
      } else {
        translateX.value = withSpring(0, { damping: 15, stiffness: 200 });
        translateY.value = withSpring(0, { damping: 15, stiffness: 200 });
      }
    });

  const animatedCardStyle = useAnimatedStyle(() => {
    const rotate = interpolate(
      translateX.value,
      [-width / 2, 0, width / 2],
      [-15, 0, 15],
      Extrapolation.CLAMP
    );
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { rotate: `${rotate}deg` },
      ],
    };
  });

  const likeOpacityStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(translateX.value, [20, 100], [0, 1], Extrapolation.CLAMP),
    };
  });

  const nopeOpacityStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(translateX.value, [-100, -20], [1, 0], Extrapolation.CLAMP),
    };
  });

  const forceSwipe = (dir: 'left' | 'right') => {
    const x = dir === 'right' ? width + 200 : -width - 200;
    translateX.value = withTiming(x, { duration: 250 }, () => {
      runOnJS(handleSwipe)(dir);
    });
    translateY.value = withTiming(0, { duration: 250 });
  };

  // ── Map API profile to card shape ───────────────────────────────
  const isValidUrl = (url?: string | null) => {
    if (!url) return false;
    if (url.startsWith('blob:') || url.startsWith('file://')) return false;
    return true;
  };

  // ── Warm upcoming card photos ───────────────────────────────────
  // Only the top card is mounted, so without this every swipe reveals a card
  // whose photo has not started downloading yet. Prefetching the next few keeps
  // the deck feeling instant; failures are ignored because the <Image> above
  // still requests the photo normally.
  useEffect(() => {
    const urls = influencers
      .slice(currentIndex + 1, currentIndex + 1 + PREFETCH_AHEAD)
      .map((p) => (isValidUrl(p.avatar_url) ? (p.avatar_url as string) : null))
      .filter((u): u is string => !!u);
    if (urls.length) Image.prefetch(urls, { cachePolicy: 'memory-disk' }).catch(() => {});
    // isValidUrl is a pure local helper with no captured state, so it is
    // deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [influencers, currentIndex]);

  // Only real profile data reaches the card; missing figures are left out
  // rather than shown as a zero, which reads as a measurement, not a blank.
  //
  // Audience figures appear only when they came from an Instagram sync. A
  // number typed straight into the database is not a measurement, and a brand
  // deciding who to pay should never be shown one as if it were.
  const toCardItem = (p: InfluencerProfile): CardItem => {
    const stats: CardItem['stats'] = [];
    if (p.stats_verified) {
      if (p.followers > 0) stats.push({ value: compact(p.followers), label: 'Followers' });
      if (p.engagement_rate > 0) stats.push({ value: `${Number(p.engagement_rate).toFixed(1)}%`, label: 'Engagement' });
      if (p.avg_views > 0) stats.push({ value: compact(p.avg_views), label: 'Avg views' });
    }

    return {
      id: p.user_id,
      image: isValidUrl(p.avatar_url) ? (p.avatar_url as string) : null,
      name: p.name || 'Creator',
      verified: !!p.verified,
      niche: (p.categories ?? []).join(' · '),
      location: p.location ?? '',
      contentTypes: p.categories ?? [],
      stats,
      workedWith: p.worked_with ?? [],
    };
  };

  const renderStack = () => {
    if (loading) {
      return (
        <View style={ss.empty}>
          <ActivityIndicator size="large" color="#FF6B2B" />
          <Text style={[ss.emptyTxt, { fontSize: 15, marginTop: 12 }]}>Finding creators</Text>
        </View>
      );
    }
    if (error) {
      return (
        <View style={ss.empty}>
          <Text style={[ss.emptyTxt, { color: '#FF6B6B' }]}>{error}</Text>
          <Pressable onPress={loadFeed} style={{ marginTop: 16, backgroundColor: '#FF6B2B', borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    if (currentIndex >= influencers.length) {
      return (
        <View style={ss.empty}>
          <Text style={ss.emptyTxt}>That is everyone for now</Text>
          <Text style={{ color: '#8A8A8A', marginTop: 8 }}>New creators appear as they join.</Text>
          <Pressable onPress={loadFeed} style={{ marginTop: 16, backgroundColor: '#FF6B2B', borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Refresh</Text>
          </Pressable>
        </View>
      );
    }

    return [...influencers]
      .map((profile, i) => {
        if (i < currentIndex) return null;
        const isTop = i === currentIndex;
        const item = toCardItem(profile);
        return (
          <GestureDetector key={profile.user_id} gesture={isTop ? panGesture : Gesture.Pan().enabled(false)}>
            <Animated.View
              style={[
                ss.cardWrapper,
                isTop
                  ? [animatedCardStyle, { zIndex: 10 }]
                  : { zIndex: 1, transform: [{ scale: 0.97 }], top: 6 },
              ]}
            >
              <Pressable style={{ flex: 1 }} onPress={() => isTop && onViewProfile && onViewProfile(profile.user_id)}>
                <CardContent item={item} />
                {isTop && (
                  <>
                    <Animated.View style={[ss.stamp, ss.likeStamp, likeOpacityStyle]}>
                      <Text style={ss.likeStampTxt}>LIKE</Text>
                    </Animated.View>
                    <Animated.View style={[ss.stamp, ss.nopeStamp, nopeOpacityStyle]}>
                      <Text style={ss.nopeStampTxt}>NOPE</Text>
                    </Animated.View>
                  </>
                )}
              </Pressable>
            </Animated.View>
          </GestureDetector>
        );
      })
      .reverse();
  };


  return (
    <SafeAreaView style={ss.safe}>
      {/* Header */}
      <View style={ss.header}>
        <View style={ss.logoRow}>
          <View style={{ marginRight: 6 }}>
            <MatchrLogo size={24} color="#F2602D" />
          </View>
          <Text style={ss.logoWord}>Matchr</Text>
        </View>
        <NotificationBell />
      </View>

      {/* Title */}
      <View style={ss.titleBlock}>
        <Text style={ss.title}>Discover Influencers</Text>
        <Text style={ss.subtitle}>Find creators that match your brand</Text>
      </View>

      {/* Card stack + action buttons */}
      <View style={ss.stackArea}>
        {renderStack()}

        {!loading && !error && currentIndex < influencers.length && (
          <View style={ss.actionRow} pointerEvents="box-none">
            <Pressable style={ss.btnPass} onPress={() => forceSwipe('left')}>
              <FontAwesome name="times" size={18} color="#FF3B30" />
            </Pressable>
            <Pressable style={ss.btnLike} onPress={() => forceSwipe('right')}>
              <FontAwesome name="heart" size={15} color="#fff" />
            </Pressable>
          </View>
        )}
      </View>

      {/* ✨ Match overlay */}
      <MatchBoomModal
        visible={!!matchData}
        meAvatar={onboardingData?.logo || null}
        themAvatar={matchData?.avatarUrl || null}
        onClose={() => setMatchData(null)}
        onIntroduce={() => {
          setMatchData(null);
          onNavigateToMessages?.();
        }}
      />
    </SafeAreaView>
  );
}

// ─── Card styles (identical proportions to influencer SwipeScreen) ─
const card = StyleSheet.create({
  wrapper: { flex: 1, borderRadius: 22, overflow: 'hidden', backgroundColor: '#0e0e0e', justifyContent: 'flex-end' },
  photo: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0, resizeMode: 'cover' },
  photoFallback: { backgroundColor: '#1C1C1C', alignItems: 'center', justifyContent: 'center' },
  fallbackInitial: { color: '#4A4A4A', fontSize: 96, fontWeight: '800' },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0, height: 160 },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%' },
  topRight: { position: 'absolute', top: 16, right: 16 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  verifiedTxt: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  // info panel
  infoPanel: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 130, backgroundColor: 'transparent' },
  infoName: { color: '#fff', fontSize: 28, fontWeight: '800' },
  infoCats: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 3 },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 },
  locationTxt: { color: '#ccc', fontSize: 12 },
  tagsScroll: { marginTop: 16, flexGrow: 0, height: 44 },
  tagsContent: { gap: 10, paddingRight: 16, alignItems: 'center', height: '100%' },
  pill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center' },
  // A caption for the row that follows, not a chip you can choose.
  pillLabel: { backgroundColor: 'transparent', borderColor: 'transparent', paddingLeft: 0, paddingRight: 4 },
  pillTxt: { color: '#FFF', fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  pillLabelTxt: { color: '#9A9A9A', fontSize: 12, fontWeight: '600' },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.2)' },
  statCol: { alignItems: 'center', flex: 1 },
  statVal: { color: '#fff', fontSize: 20, fontWeight: '800' },
  statLbl: { color: '#aaa', fontSize: 11, marginTop: 3, textAlign: 'center' },
  statDivider: { width: StyleSheet.hairlineWidth, height: 32, backgroundColor: 'rgba(255,255,255,0.2)' },
  workedRow: { marginTop: 16, alignItems: 'flex-start', paddingRight: 80 },
  workedLbl: { color: '#9A9A9A', fontSize: 12, fontWeight: '600', marginBottom: 8 },
  logosContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  workedChip: {
    maxWidth: 130,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  workedChipTxt: { color: '#E6E6E6', fontSize: 12, fontWeight: '500' },
  workedMore: { color: '#9A9A9A', fontSize: 12, fontWeight: '600' },
});

// ─── Screen styles (identical to influencer SwipeScreen) ──────────
const ss = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 4 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logoM: { fontSize: 26, fontWeight: '900', color: '#FF6B2B' },
  logoWord: { fontSize: 22, fontWeight: '700', color: '#fff' },
  titleBlock: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  subtitle: { color: '#888', fontSize: 13, marginTop: 3 },
  stackArea: { flex: 1, marginHorizontal: 16, marginBottom: 16, position: 'relative' },
  cardWrapper: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  stamp: { position: 'absolute', top: 40, borderWidth: 4, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.4)' },
  likeStamp: { left: 40, borderColor: '#4CAF50', transform: [{ rotate: '-15deg' }] },
  likeStampTxt: { color: '#4CAF50', fontSize: 28, fontWeight: '900', letterSpacing: 2 },
  nopeStamp: { right: 40, borderColor: '#FF3B30', transform: [{ rotate: '15deg' }] },
  nopeStampTxt: { color: '#FF3B30', fontSize: 28, fontWeight: '900', letterSpacing: 2 },
  actionRow: { position: 'absolute', bottom: 70, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 28, zIndex: 100 },
  btnPass: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', boxShadow: '0px 3px 6px rgba(0,0,0,0.18)', elevation: 5 },
  btnLike: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#FF6B2B', justifyContent: 'center', alignItems: 'center', boxShadow: '0px 4px 8px rgba(255,107,43,0.4)', elevation: 7 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyTxt: { color: '#fff', fontSize: 20, fontWeight: '600' },
  // Match overlay
  matchOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255, 107, 43, 0.92)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 999,
  },
  matchEmoji: { fontSize: 64, marginBottom: 12 },
  matchTitle: { color: '#fff', fontSize: 36, fontWeight: '900', letterSpacing: -1 },
  matchSub: { color: 'rgba(255,255,255,0.85)', fontSize: 17, marginTop: 8, fontWeight: '500' },
});

