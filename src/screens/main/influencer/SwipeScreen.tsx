import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { BrandProfile } from '@/api/types';
import { MatchrLogo } from '@/components/MatchrLogo';
import { MatchBoomModal } from '@/components/MatchBoomModal';
import { useAuth } from '@/contexts/AuthContext';
import { showAlert } from '@/components/ActionSheet';
import { NotificationBell } from '@/components/NotificationBell';
import { sz, tabBarClearance } from '@/theme/scale';
import { SwipeDeck, type SwipeDeckHandle, type SwipeDir } from '@/features/swipe/SwipeDeck';
import { useSwipeQueue } from '@/features/swipe/useSwipeQueue';


const ACCENT = '#FF6B2B';

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
          <MaterialCommunityIcons name="check-decagram" size={sz(15)} color={ACCENT} />
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
          <Ionicons name="location-sharp" size={sz(14)} color="#AAA" />
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
const cardPhoto = (p: BrandProfile) => toCardItem(p).image;
const renderBrandCard = (p: BrandProfile) => <CardContent item={toCardItem(p)} />;
const brandKey = (p: BrandProfile) => p.user_id;
const brandLabel = (p: BrandProfile) => p.name || 'Brand';

export function SwipeScreen({ onViewProfile, onNavigateToMessages }: { onViewProfile?: (id: string) => void, onNavigateToMessages?: () => void }) {
  const { onboardingData } = useAuth();
  const { deck, loading, error, loadingMore, loadFeed, commit } = useSwipeQueue<BrandProfile>(cardPhoto);
  const [matchData, setMatchData] = useState<{ name: string; avatarUrl: string | null } | null>(null);
  const deckRef = useRef<SwipeDeckHandle>(null);
  // Stable elements, so the deck's memoised cards don't re-render.
  const likeStamp = useMemo(() => (
    <View style={[ss.stamp, ss.likeStamp]}>
      <Text style={ss.likeStampTxt}>LIKE</Text>
    </View>
  ), []);
  const nopeStamp = useMemo(() => (
    <View style={[ss.stamp, ss.nopeStamp]}>
      <Text style={ss.nopeStampTxt}>PASS</Text>
    </View>
  ), []);

  const handleSwipe = useCallback(async (profile: BrandProfile, dir: SwipeDir) => {
    // The match screen shows the logo; start loading it while the swipe saves.
    const logo = isValidUrl(profile.logo_url) ? profile.logo_url : null;
    if (dir === 'right' && logo) Image.prefetch(logo, { cachePolicy: 'memory-disk' }).catch(() => {});
    try {
      const res = await commit(profile, dir);
      if (dir === 'right' && res.matched) {
        setMatchData({ name: profile.name ?? 'This brand', avatarUrl: logo ?? cardPhoto(profile) });
      }
    } catch (e) {
      console.warn('[API] recordSwipe failed:', e);
      showAlert('Swipe not saved', 'We brought the card back. Check your connection and try again.');
    }
  }, [commit]);

  const openProfile = useCallback((p: BrandProfile) => onViewProfile?.(p.user_id), [onViewProfile]);

  const renderStack = () => {
    // A page still on its way shows the skeleton, not "you've seen everyone".
    if (loading || (deck.length === 0 && loadingMore)) {
      return (
        <View style={[card.wrapper, card.skeleton]} accessibilityLabel="Finding brands">
          <View style={card.infoPanel}>
            <View style={[ss.skeletonLine, { width: '55%', height: sz(24) }]} />
            <View style={[ss.skeletonLine, { width: '35%', marginTop: sz(10) }]} />
            <View style={[ss.skeletonLine, { width: '70%', height: sz(36), marginTop: sz(22), borderRadius: sz(18) }]} />
          </View>
        </View>
      );
    }
    if (error) {
      return (
        <View style={ss.empty}>
          <View style={ss.emptyIcon}>
            <Ionicons name="cloud-offline-outline" size={sz(28)} color="#BDBDBD" />
          </View>
          <Text style={ss.emptyTxt}>Couldn't load brands</Text>
          <Text style={ss.emptySub}>Check your connection and try again.</Text>
          <Pressable onPress={loadFeed} accessibilityRole="button" style={({ pressed }) => [ss.emptyBtn, pressed && ss.pressed]}>
            <Text style={ss.emptyBtnTxt}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    if (deck.length === 0) {
      return (
        <View style={ss.empty}>
          <View style={ss.emptyIcon}>
            <Ionicons name="checkmark-done" size={sz(28)} color={ACCENT} />
          </View>
          <Text style={ss.emptyTxt}>You've seen all brands</Text>
          <Text style={ss.emptySub}>New brands join every day. Check back soon.</Text>
          <Pressable onPress={loadFeed} accessibilityRole="button" style={({ pressed }) => [ss.emptyBtn, pressed && ss.pressed]}>
            <Text style={ss.emptyBtnTxt}>Refresh</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <SwipeDeck
        ref={deckRef}
        items={deck}
        keyOf={brandKey}
        labelOf={brandLabel}
        renderCard={renderBrandCard}
        likeStamp={likeStamp}
        nopeStamp={nopeStamp}
        onSwipe={handleSwipe}
        onOpen={openProfile}
      />
    );
  };


  return (
    <SafeAreaView style={ss.safe}>
      {/* ── Header ── */}
      <View style={ss.header}>
        <View style={ss.logoRow}>
          <View style={{ marginRight: sz(6) }}>
            <MatchrLogo size={sz(24)} color={ACCENT} />
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

        {!loading && !error && deck.length > 0 && (
          <View style={ss.actionRow} pointerEvents="box-none">
            <Pressable
              onPress={() => deckRef.current?.swipe('left')}
              accessibilityRole="button"
              accessibilityLabel="Pass"
              style={({ pressed }) => [ss.btnPass, pressed && ss.pressed]}
            >
              <Ionicons name="close" size={sz(28)} color="#111" />
            </Pressable>
            <Pressable
              onPress={() => deckRef.current?.swipe('right')}
              accessibilityRole="button"
              accessibilityLabel="Like"
              style={({ pressed }) => [ss.btnLike, pressed && ss.pressed]}
            >
              <Ionicons name="heart" size={sz(26)} color="#FFF" />
            </Pressable>
          </View>
        )}
      </View>
      
      {/* ✨ Match overlay */}
      <MatchBoomModal
        visible={!!matchData}
        meAvatar={onboardingData?.photos?.[0] || null}
        themAvatar={matchData?.avatarUrl || null}
        themName={matchData?.name}
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
    borderRadius: sz(22),
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
    paddingBottom: tabBarClearance(180),
  },
  fallbackInitial: { color: '#333', fontSize: sz(120), fontWeight: '800' },
  skeleton: { flex: 1, backgroundColor: '#1A1A1A' },
  topFade: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: sz(160),
  },
  bottomFade: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: '60%',
  },
  topRight: { position: 'absolute', top: sz(16), right: sz(16) },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: sz(5),
    backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: sz(11), paddingVertical: sz(6), borderRadius: sz(20),
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  verifiedTxt: { color: '#FFF', fontSize: sz(12), fontWeight: '600' },
  photoText: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    paddingHorizontal: sz(22),
    paddingBottom: sz(20),
  },
  theWord: {
    color: '#fff',
    fontSize: sz(20),
    fontWeight: '300',
    letterSpacing: 1,
  },
  hugeName: {
    color: '#fff',
    fontSize: sz(38),
    fontWeight: '800',
    marginTop: sz(-4),
    letterSpacing: -0.5,
  },
  rule: {
    width: sz(56),
    height: sz(2),
    backgroundColor: '#FF6B2B',
    marginVertical: sz(10),
  },
  slogan: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: sz(13),
    lineHeight: sz(19),
    fontWeight: '400',
  },
  // ── info panel ──
  infoPanel: {
    paddingHorizontal: sz(20),
    paddingTop: sz(14),
    paddingBottom: tabBarClearance(130), // increased space for the overlapping buttons
    backgroundColor: 'transparent',
  },
  infoName: {
    color: '#fff',
    fontSize: sz(30),
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  infoCats: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: sz(14),
    marginTop: sz(3),
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: sz(6),
    gap: sz(4),
  },
  locationTxt: {
    color: '#ccc',
    fontSize: sz(12),
  },
  tagsScroll: { marginTop: sz(16), flexGrow: 0, height: sz(44) },
  tagsContent: { gap: sz(10), paddingRight: sz(16), alignItems: 'center', height: '100%' },
  pill: { paddingHorizontal: sz(15), paddingVertical: sz(7), borderRadius: sz(22), backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center' },
  pillLabel: { backgroundColor: 'rgba(255,107,43,0.16)', borderColor: 'rgba(255,107,43,0.45)' },
  pillTxt: { color: '#FFF', fontSize: sz(13), fontWeight: '600' },
  pillLabelTxt: { color: '#FF8A55', fontSize: sz(13), fontWeight: '700' },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: sz(20),
    paddingTop: sz(14),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  statCol: { alignItems: 'center', flex: 1, paddingHorizontal: sz(6) },
  statVal: { color: '#fff', fontSize: sz(18), fontWeight: '700', fontVariant: ['tabular-nums'] },
  statLbl: { color: '#aaa', fontSize: sz(11), marginTop: sz(3), textAlign: 'center' },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: sz(32),
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
    paddingHorizontal: sz(20),
    paddingTop: sz(6),
    paddingBottom: sz(4),
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: sz(6) },
  logoM: { fontSize: sz(26), fontWeight: '900', color: '#FF6B2B' },
  logoWord: { fontSize: sz(22), fontWeight: '700', color: '#fff' },
  titleBlock: {
    paddingHorizontal: sz(20),
    paddingBottom: sz(12),
  },
  title: {
    color: '#fff',
    fontSize: sz(22),
    fontWeight: '700',
  },
  subtitle: {
    color: '#9A9A9A',
    fontSize: sz(13),
    marginTop: sz(3),
  },
  // The area that holds both the stacked cards AND the floating buttons
  stackArea: {
    flex: 1,
    marginHorizontal: sz(16),
    marginBottom: sz(16),
    position: 'relative',
  },
  cardWrapper: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  // Buttons are positioned absolutely inside stackArea, near the bottom
  actionRow: {
    position: 'absolute',
    bottom: tabBarClearance(70),
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: sz(28),
    zIndex: 100,
  },
  btnPass: {
    width: sz(56),
    height: sz(56),
    borderRadius: sz(28),
    backgroundColor: '#F4F4F4',
    justifyContent: 'center',
    alignItems: 'center',
    boxShadow: '0px 6px 14px rgba(0,0,0,0.35)',
    elevation: 6,
  },
  btnLike: {
    width: sz(64),
    height: sz(64),
    borderRadius: sz(32),
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
    paddingHorizontal: sz(32),
  },
  emptyIcon: {
    width: sz(64), height: sz(64), borderRadius: sz(32), backgroundColor: '#1E1E1E',
    justifyContent: 'center', alignItems: 'center', marginBottom: sz(18),
  },
  emptyTxt: {
    color: '#fff',
    fontSize: sz(20),
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySub: { color: '#9A9A9A', fontSize: sz(14), lineHeight: sz(20), textAlign: 'center', marginTop: sz(6) },
  emptyBtn: {
    marginTop: sz(22), borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: sz(12),
    paddingVertical: sz(11), paddingHorizontal: sz(24),
  },
  emptyBtnTxt: { color: '#FFF', fontSize: sz(15), fontWeight: '600' },
  skeletonLine: { height: sz(12), borderRadius: sz(6), backgroundColor: '#262626' },
  stamp: {
    position: 'absolute',
    top: sz(40),
    borderWidth: 4,
    borderRadius: sz(8),
    paddingHorizontal: sz(12),
    paddingVertical: sz(6),
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  likeStamp: {
    left: sz(40),
    borderColor: ACCENT,
    transform: [{ rotate: '-15deg' }],
  },
  likeStampTxt: {
    color: ACCENT,
    fontSize: sz(28),
    fontWeight: '900',
    letterSpacing: sz(2),
  },
  nopeStamp: {
    right: sz(40),
    borderColor: '#FFF',
    transform: [{ rotate: '15deg' }],
  },
  nopeStampTxt: {
    color: '#FFF',
    fontSize: sz(28),
    fontWeight: '900',
    letterSpacing: sz(2),
  },
});
