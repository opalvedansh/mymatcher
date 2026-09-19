import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  useWindowDimensions,
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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getFeed, recordSwipe } from '@/api';
import type { BrandProfile } from '@/api/types';
import { MatchrLogo } from '@/components/MatchrLogo';
import { MatchBoomModal } from '@/components/MatchBoomModal';
import { useAuth } from '@/contexts/AuthContext';
import { showAlert } from '@/components/ActionSheet';
import { NotificationBell } from '@/components/NotificationBell';


const ACCENT = '#FF6B2B';
const PAGE_SIZE = 20;
// How many upcoming card photos to pull into the cache ahead of the user.
const PREFETCH_AHEAD = 3;

type CardItem = {
  id: string;
  image: string | null;
  name: string;
  verified: boolean;
  categories: string;
  location: string;
  campaignTypes: string[];
  stats: { value: string; label: string }[];
};

const isValidUrl = (url?: string | null): url is string =>
  !!url && !url.startsWith('blob:') && !url.startsWith('file://');

const formatInr = (amount: number) =>
  amount >= 100_000
    ? `₹${+(amount / 100_000).toFixed(1)}L`
    : amount >= 1000
      ? `₹${Math.round(amount / 1000)}k`
      : `₹${amount}`;

function formatBudget(min?: number | null, max?: number | null) {
  if (min && max) return `${formatInr(min)}-${formatInr(max).slice(1)}`;
  if (min) return `${formatInr(min)}+`;
  if (max) return `Up to ${formatInr(max)}`;
  return null;
}

// Only real profile data reaches the card; missing fields are hidden, not faked.
function toCardItem(p: BrandProfile): CardItem {
  const stats: CardItem['stats'] = [];
  const budget = formatBudget(p.budget_min, p.budget_max);
  if (budget) stats.push({ value: budget, label: 'Budget Range' });
  if (p.vibes?.length) stats.push({ value: p.vibes[0], label: 'Brand Vibe' });
  if (p.campaign_types?.length) {
    stats.push({ value: String(p.campaign_types.length), label: p.campaign_types.length === 1 ? 'Campaign Type' : 'Campaign Types' });
  }
  const cover = isValidUrl(p.cover_url) ? p.cover_url : null;
  const logo = isValidUrl(p.logo_url) ? p.logo_url : null;

  return {
    id: p.user_id,
    image: cover ?? logo,
    name: p.name || 'Brand',
    verified: !!p.verified,
    categories: (p.categories ?? []).join(', '),
    location: p.location ?? '',
    campaignTypes: p.campaign_types ?? [],
    stats,
  };
}

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
        // key the next brand briefly shows the previous brand's photo.
        recyclingKey={item.id}
      />
    ) : (
      <View style={[card.photo, card.photoFallback]}>
        <Text style={card.fallbackInitial}>{item.name.charAt(0).toUpperCase()}</Text>
      </View>
    )}

    {/* gradient so brand name reads clearly on top of image */}
    <LinearGradient
      colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.0)']}
      style={card.topFade}
      pointerEvents="none"
    />
    <LinearGradient
      colors={['rgba(0,0,0,0.0)', 'rgba(14,14,14,0.85)', 'rgba(14,14,14,1)']}
      locations={[0, 0.45, 1]}
      style={card.bottomFade}
      pointerEvents="none"
    />

    {/* Verified badge top-right, only for brands that passed verification */}
    {item.verified && (
      <View style={card.topRight}>
        <View style={card.verifiedBadge}>
          <MaterialCommunityIcons name="check-decagram" size={15} color={ACCENT} />
          <Text style={card.verifiedTxt}>Verified Brand</Text>
        </View>
      </View>
    )}

    {/* ── Info panel ── */}
    <View style={card.infoPanel}>
      <Text style={card.infoName} numberOfLines={1}>{item.name}</Text>
      {!!item.categories && <Text style={card.infoCats} numberOfLines={1}>{item.categories}</Text>}
      {!!item.location && (
        <View style={card.locationRow}>
          <Ionicons name="location-sharp" size={14} color="#AAA" />
          <Text style={card.locationTxt} numberOfLines={1}>{item.location}</Text>
        </View>
      )}

      {/* Campaign Types (Tags) */}
      {item.campaignTypes.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={card.tagsScroll}
          contentContainerStyle={card.tagsContent}
        >
          <View style={[card.pill, card.pillLabel]}>
            <Text style={card.pillLabelTxt}>Looking for</Text>
          </View>
          {item.campaignTypes.map((t) => (
            <View key={t} style={card.pill}>
              <Text style={card.pillTxt}>{t}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Stats (Budget, Vibe, Campaign types) */}
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
    </View>
  </View>
);

// ─── Main Screen ──────────────────────────────────────────────────
export function SwipeScreen({ onViewProfile, onNavigateToMessages }: { onViewProfile?: (id: string) => void, onNavigateToMessages?: () => void }) {
  const { onboardingData } = useAuth();
  const { width } = useWindowDimensions();
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [matchData, setMatchData] = useState<{ name: string; avatarUrl: string | null } | null>(null);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const nextCursorRef = useRef<{ score: number | null, id: string | null }>({ score: null, id: null });
  const loadingMoreRef = useRef(false);
  const busyRef = useRef(false);

  // ── Load feed ───────────────────────────────────────────────────
  const loadFeed = useCallback(async () => {
    try {
      setLoading(true);
      setError(false);
      // No cursor on the first page; the server hands back the next one.
      const res = await getFeed(PAGE_SIZE);
      setBrands(res.data as BrandProfile[]);
      setCurrentIndex(0);
      nextCursorRef.current = { score: res.next_cursor_score, id: res.next_cursor_id };
    } catch (e) {
      console.warn('[API] getFeed failed:', e);
      setError(true);
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
      const page = res.data as BrandProfile[];
      setBrands(prev => {
        const seen = new Set(prev.map(b => b.user_id));
        return [...prev, ...page.filter(b => !seen.has(b.user_id))];
      });
    } catch {/* the next swipe retries */} finally {
      loadingMoreRef.current = false;
    }
  }, []);

  // ── Warm upcoming card photos ───────────────────────────────────
  // Only the top card is mounted, so without this every swipe reveals a card
  // whose photo has not started downloading yet. Prefetching the next few keeps
  // the deck feeling instant; failures are ignored because the <Image> below
  // still requests the photo normally.
  useEffect(() => {
    const urls = brands
      .slice(currentIndex + 1, currentIndex + 1 + PREFETCH_AHEAD)
      .map((b) => (isValidUrl(b.cover_url) ? b.cover_url : isValidUrl(b.logo_url) ? b.logo_url : null))
      .filter((u): u is string => !!u);
    if (urls.length) Image.prefetch(urls, { cachePolicy: 'memory-disk' }).catch(() => {});
  }, [brands, currentIndex]);

  // ── Swipe handler ───────────────────────────────────────────────
  const handleSwipe = useCallback(async (dir: 'left' | 'right') => {
    busyRef.current = false;
    const profile = brands[currentIndex];
    if (!profile) return;

    const prevIndex = currentIndex;
    setCurrentIndex(p => p + 1);
    translateX.value = 0;
    translateY.value = 0;

    // Fetch the next page while a few cards are still left.
    if (brands.length - (currentIndex + 1) <= 3) loadMore();

    try {
      const res = await recordSwipe(profile.user_id, dir === 'right' ? 'like' : 'reject');
      const responseData = (res as any).data || res;
      if (dir === 'right' && responseData.matched) {
        const rawUrl = profile.logo_url ?? profile.cover_url;
        setMatchData({ name: profile.name ?? 'This brand', avatarUrl: isValidUrl(rawUrl) ? rawUrl : null });
      }
    } catch (e) {
      console.warn('[API] recordSwipe failed:', e);
      setCurrentIndex(prevIndex);
      showAlert('Swipe not saved', 'We brought the card back. Check your connection and try again.');
    }
  }, [brands, currentIndex, translateX, translateY, loadMore]);

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
    // Ignore repeat taps while a card is already flying off.
    if (busyRef.current) return;
    busyRef.current = true;
    const x = dir === 'right' ? width + 200 : -width - 200;
    translateX.value = withTiming(x, { duration: 250 }, () => {
      runOnJS(handleSwipe)(dir);
    });
    translateY.value = withTiming(0, { duration: 250 });
  };

  const renderStack = () => {
    if (loading) {
      return (
        <View style={[card.wrapper, card.skeleton]} accessibilityLabel="Finding brands">
          <View style={card.infoPanel}>
            <View style={[ss.skeletonLine, { width: '55%', height: 24 }]} />
            <View style={[ss.skeletonLine, { width: '35%', marginTop: 10 }]} />
            <View style={[ss.skeletonLine, { width: '70%', height: 36, marginTop: 22, borderRadius: 18 }]} />
          </View>
        </View>
      );
    }
    if (error) {
      return (
        <View style={ss.empty}>
          <View style={ss.emptyIcon}>
            <Ionicons name="cloud-offline-outline" size={28} color="#BDBDBD" />
          </View>
          <Text style={ss.emptyTxt}>Couldn't load brands</Text>
          <Text style={ss.emptySub}>Check your connection and try again.</Text>
          <Pressable onPress={loadFeed} accessibilityRole="button" style={({ pressed }) => [ss.emptyBtn, pressed && ss.pressed]}>
            <Text style={ss.emptyBtnTxt}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    if (currentIndex >= brands.length) {
      return (
        <View style={ss.empty}>
          <View style={ss.emptyIcon}>
            <Ionicons name="checkmark-done" size={28} color={ACCENT} />
          </View>
          <Text style={ss.emptyTxt}>You've seen all brands</Text>
          <Text style={ss.emptySub}>New brands join every day. Check back soon.</Text>
          <Pressable onPress={loadFeed} accessibilityRole="button" style={({ pressed }) => [ss.emptyBtn, pressed && ss.pressed]}>
            <Text style={ss.emptyBtnTxt}>Refresh</Text>
          </Pressable>
        </View>
      );
    }

    // Only the top two cards are mounted, so the rest don't load images yet.
    return brands
      .slice(currentIndex, currentIndex + 2)
      .map((profile, offset) => {
        const isTop = offset === 0;
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
              <Pressable
                style={{ flex: 1 }}
                onPress={() => isTop && onViewProfile && onViewProfile(profile.user_id)}
                accessibilityLabel={item.name}
                accessibilityHint="Swipe right to like, left to pass"
              >
                <CardContent item={item} />
                {isTop && (
                  <>
                    <Animated.View style={[ss.stamp, ss.likeStamp, likeOpacityStyle]} pointerEvents="none">
                      <Text style={ss.likeStampTxt}>LIKE</Text>
                    </Animated.View>
                    <Animated.View style={[ss.stamp, ss.nopeStamp, nopeOpacityStyle]} pointerEvents="none">
                      <Text style={ss.nopeStampTxt}>PASS</Text>
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
      {/* ── Header ── */}
      <View style={ss.header}>
        <View style={ss.logoRow}>
          <View style={{ marginRight: 6 }}>
            <MatchrLogo size={24} color={ACCENT} />
          </View>
          <Text style={ss.logoWord}>Matchr</Text>
        </View>
        <NotificationBell />
      </View>

      {/* ── Title ── */}
      <View style={ss.titleBlock}>
        <Text style={ss.title}>Discover Brands</Text>
        <Text style={ss.subtitle}>Find brands that match your vibe</Text>
      </View>

      {/* ── Card stack + overlapping buttons ── */}
      <View style={ss.stackArea}>
        {renderStack()}

        {!loading && !error && currentIndex < brands.length && (
          <View style={ss.actionRow} pointerEvents="box-none">
            <Pressable
              onPress={() => forceSwipe('left')}
              accessibilityRole="button"
              accessibilityLabel="Pass"
              style={({ pressed }) => [ss.btnPass, pressed && ss.pressed]}
            >
              <Ionicons name="close" size={28} color="#111" />
            </Pressable>
            <Pressable
              onPress={() => forceSwipe('right')}
              accessibilityRole="button"
              accessibilityLabel="Like"
              style={({ pressed }) => [ss.btnLike, pressed && ss.pressed]}
            >
              <Ionicons name="heart" size={26} color="#FFF" />
            </Pressable>
          </View>
        )}
      </View>
      
      {/* ✨ Match overlay */}
      <MatchBoomModal
        visible={!!matchData}
        meAvatar={onboardingData?.photos?.[0] || null}
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

// ─────────────────────────── card styles ──────────────────────────
const card = StyleSheet.create({
  wrapper: {
    flex: 1,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#0e0e0e',
    justifyContent: 'flex-end',
  },
  photo: {
    position: 'absolute',
    top: 0, left: 0, bottom: 0, right: 0,
  },
  photoFallback: {
    backgroundColor: '#1C1C1C',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 180,
  },
  fallbackInitial: { color: '#333', fontSize: 120, fontWeight: '800' },
  skeleton: { flex: 1, backgroundColor: '#1A1A1A' },
  topFade: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 160,
  },
  bottomFade: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: '60%',
  },
  topRight: { position: 'absolute', top: 16, right: 16 },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  verifiedTxt: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  photoText: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    paddingHorizontal: 22,
    paddingBottom: 20,
  },
  theWord: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '300',
    letterSpacing: 1,
  },
  hugeName: {
    color: '#fff',
    fontSize: 38,
    fontWeight: '800',
    marginTop: -4,
    letterSpacing: -0.5,
  },
  rule: {
    width: 56,
    height: 2,
    backgroundColor: '#FF6B2B',
    marginVertical: 10,
  },
  slogan: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '400',
  },
  // ── info panel ──
  infoPanel: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 130, // increased space for the overlapping buttons
    backgroundColor: 'transparent',
  },
  infoName: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  infoCats: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    marginTop: 3,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  locationTxt: {
    color: '#ccc',
    fontSize: 12,
  },
  tagsScroll: { marginTop: 16, flexGrow: 0, height: 44 },
  tagsContent: { gap: 10, paddingRight: 16, alignItems: 'center', height: '100%' },
  pill: { paddingHorizontal: 15, paddingVertical: 7, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center' },
  pillLabel: { backgroundColor: 'rgba(255,107,43,0.16)', borderColor: 'rgba(255,107,43,0.45)' },
  pillTxt: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  pillLabelTxt: { color: '#FF8A55', fontSize: 13, fontWeight: '700' },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  statCol: { alignItems: 'center', flex: 1, paddingHorizontal: 6 },
  statVal: { color: '#fff', fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statLbl: { color: '#aaa', fontSize: 11, marginTop: 3, textAlign: 'center' },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
});

// ─────────────────────────── screen styles ────────────────────────
const ss = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 4,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logoM: { fontSize: 26, fontWeight: '900', color: '#FF6B2B' },
  logoWord: { fontSize: 22, fontWeight: '700', color: '#fff' },
  titleBlock: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: '#9A9A9A',
    fontSize: 13,
    marginTop: 3,
  },
  // The area that holds both the stacked cards AND the floating buttons
  stackArea: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 16,
    position: 'relative',
  },
  cardWrapper: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  // Buttons are positioned absolutely inside stackArea, near the bottom
  actionRow: {
    position: 'absolute',
    bottom: 70,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 28,
    zIndex: 100,
  },
  btnPass: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F4F4F4',
    justifyContent: 'center',
    alignItems: 'center',
    boxShadow: '0px 6px 14px rgba(0,0,0,0.35)',
    elevation: 6,
  },
  btnLike: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: ACCENT,
    justifyContent: 'center',
    alignItems: 'center',
    boxShadow: '0px 6px 14px rgba(0,0,0,0.35)',
    elevation: 6,
  },
  pressed: { transform: [{ scale: 0.94 }], opacity: 0.9 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#1E1E1E',
    justifyContent: 'center', alignItems: 'center', marginBottom: 18,
  },
  emptyTxt: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySub: { color: '#9A9A9A', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6 },
  emptyBtn: {
    marginTop: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 12,
    paddingVertical: 11, paddingHorizontal: 24,
  },
  emptyBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: '#262626' },
  stamp: {
    position: 'absolute',
    top: 40,
    borderWidth: 4,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  likeStamp: {
    left: 40,
    borderColor: ACCENT,
    transform: [{ rotate: '-15deg' }],
  },
  likeStampTxt: {
    color: ACCENT,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 2,
  },
  nopeStamp: {
    right: 40,
    borderColor: '#FFF',
    transform: [{ rotate: '15deg' }],
  },
  nopeStampTxt: {
    color: '#FFF',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 2,
  },
});
