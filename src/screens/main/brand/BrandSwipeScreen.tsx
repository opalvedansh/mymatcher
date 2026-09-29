import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, FontAwesome, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { InfluencerProfile } from '@/api/types';
import { MatchrLogo } from '@/components/MatchrLogo';
import { MatchBoomModal } from '@/components/MatchBoomModal';
import { useAuth } from '@/contexts/AuthContext';
import { NotificationBell } from '@/components/NotificationBell';
import { showAlert } from '@/components/ActionSheet';
import { sz, tabBarClearance } from '@/theme/scale';
import { SwipeDeck, type SwipeDeckHandle, type SwipeDir } from '@/features/swipe/SwipeDeck';
import { useSwipeQueue } from '@/features/swipe/useSwipeQueue';

const ACCENT = '#FF6B2B';

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
          <MaterialCommunityIcons name="check-decagram" size={sz(15)} color={ACCENT} />
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
          <Ionicons name="location-sharp" size={sz(14)} color="#aaa" />
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

// ─── Map API profile to card shape ───────────────────────────────
const isValidUrl = (url?: string | null): url is string =>
  !!url && !url.startsWith('blob:') && !url.startsWith('file://');

// Only real profile data reaches the card; missing figures are left out
// rather than shown as a zero, which reads as a measurement, not a blank.
//
// Audience figures appear only when they came from an Instagram sync. A
// number typed straight into the database is not a measurement, and a brand
// deciding who to pay should never be shown one as if it were.
function toCardItem(p: InfluencerProfile): CardItem {
  const stats: CardItem['stats'] = [];
  if (p.stats_verified) {
    if (p.followers > 0) stats.push({ value: compact(p.followers), label: 'Followers' });
    if (p.engagement_rate > 0) stats.push({ value: `${Number(p.engagement_rate).toFixed(1)}%`, label: 'Engagement' });
    if (p.avg_views > 0) stats.push({ value: compact(p.avg_views), label: 'Avg views' });
  }

  return {
    id: p.user_id,
    image: isValidUrl(p.avatar_url) ? p.avatar_url : null,
    name: p.name || 'Creator',
    verified: !!p.verified,
    niche: (p.categories ?? []).join(' · '),
    location: p.location ?? '',
    contentTypes: p.categories ?? [],
    stats,
    workedWith: p.worked_with ?? [],
  };
}

// ─── Main Screen ──────────────────────────────────────────────────
const cardPhoto = (p: InfluencerProfile) => (isValidUrl(p.avatar_url) ? p.avatar_url : null);
const renderCreatorCard = (p: InfluencerProfile) => <CardContent item={toCardItem(p)} />;
const creatorKey = (p: InfluencerProfile) => p.user_id;
const creatorLabel = (p: InfluencerProfile) => p.name || 'Creator';

export function BrandSwipeScreen({ onViewProfile, onNavigateToMessages }: { onViewProfile?: (id: string) => void, onNavigateToMessages?: () => void }) {
  const { onboardingData } = useAuth();
  const { deck, loading, error, loadingMore, loadFeed, commit } = useSwipeQueue<InfluencerProfile>(cardPhoto);
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
      <Text style={ss.nopeStampTxt}>NOPE</Text>
    </View>
  ), []);

  // ── Swipe handler ───────────────────────────────────────────────
  const handleSwipe = useCallback(async (profile: InfluencerProfile, dir: SwipeDir) => {
    try {
      const res = await commit(profile, dir);
      if (dir === 'right' && res.matched) {
        setMatchData({ name: profile.name ?? 'This creator', avatarUrl: cardPhoto(profile) });
      }
    } catch (e) {
      console.warn('[API] recordSwipe failed:', e);
      showAlert('Swipe not saved', 'We brought the card back. Check your connection and try again.');
    }
  }, [commit]);

  const openProfile = useCallback((p: InfluencerProfile) => onViewProfile?.(p.user_id), [onViewProfile]);

  const renderStack = () => {
    // A page still on its way keeps the spinner up, not "that is everyone".
    if (loading || (deck.length === 0 && loadingMore)) {
      return (
        <View style={ss.empty}>
          <ActivityIndicator size="large" color="#FF6B2B" />
          <Text style={[ss.emptyTxt, { fontSize: sz(15), marginTop: sz(12) }]}>Finding creators</Text>
        </View>
      );
    }
    if (error) {
      return (
        <View style={ss.empty}>
          <Text style={[ss.emptyTxt, { color: '#FF6B6B' }]}>Couldn't load creators</Text>
          <Pressable onPress={loadFeed} style={({ pressed }) => [ss.emptyBtn, pressed && ss.pressed]}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    if (deck.length === 0) {
      return (
        <View style={ss.empty}>
          <Text style={ss.emptyTxt}>That is everyone for now</Text>
          <Text style={{ color: '#8A8A8A', marginTop: sz(8) }}>New creators appear as they join.</Text>
          <Pressable onPress={loadFeed} style={({ pressed }) => [ss.emptyBtn, pressed && ss.pressed]}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Refresh</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <SwipeDeck
        ref={deckRef}
        items={deck}
        keyOf={creatorKey}
        labelOf={creatorLabel}
        renderCard={renderCreatorCard}
        likeStamp={likeStamp}
        nopeStamp={nopeStamp}
        onSwipe={handleSwipe}
        onOpen={openProfile}
      />
    );
  };


  return (
    <SafeAreaView style={ss.safe}>
      {/* Header */}
      <View style={ss.header}>
        <View style={ss.logoRow}>
          <View style={{ marginRight: sz(6) }}>
            <MatchrLogo size={sz(24)} color="#F2602D" />
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

        {!loading && !error && deck.length > 0 && (
          <View style={ss.actionRow} pointerEvents="box-none">
            <Pressable
              style={({ pressed }) => [ss.btnPass, pressed && ss.pressed]}
              onPress={() => deckRef.current?.swipe('left')}
              accessibilityRole="button"
              accessibilityLabel="Pass"
            >
              <FontAwesome name="times" size={sz(18)} color="#FF3B30" />
            </Pressable>
            <Pressable
              style={({ pressed }) => [ss.btnLike, pressed && ss.pressed]}
              onPress={() => deckRef.current?.swipe('right')}
              accessibilityRole="button"
              accessibilityLabel="Like"
            >
              <FontAwesome name="heart" size={sz(15)} color="#fff" />
            </Pressable>
          </View>
        )}
      </View>

      {/* ✨ Match overlay */}
      <MatchBoomModal
        visible={!!matchData}
        meAvatar={onboardingData?.logo || null}
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

// ─── Card styles (identical proportions to influencer SwipeScreen) ─
const card = StyleSheet.create({
  wrapper: { flex: 1, borderRadius: sz(22), overflow: 'hidden', backgroundColor: '#0e0e0e', justifyContent: 'flex-end' },
  photo: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0, resizeMode: 'cover' },
  photoFallback: { backgroundColor: '#1C1C1C', alignItems: 'center', justifyContent: 'center' },
  fallbackInitial: { color: '#4A4A4A', fontSize: sz(96), fontWeight: '800' },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0, height: sz(160) },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%' },
  topRight: { position: 'absolute', top: sz(16), right: sz(16) },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: sz(4), backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: sz(10), paddingVertical: sz(5), borderRadius: sz(20) },
  verifiedTxt: { color: '#FFF', fontSize: sz(11), fontWeight: '600' },
  // info panel
  infoPanel: { paddingHorizontal: sz(20), paddingTop: sz(14), paddingBottom: tabBarClearance(130), backgroundColor: 'transparent' },
  infoName: { color: '#fff', fontSize: sz(28), fontWeight: '800' },
  infoCats: { color: 'rgba(255,255,255,0.8)', fontSize: sz(14), marginTop: sz(3) },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginTop: sz(6), gap: sz(4) },
  locationTxt: { color: '#ccc', fontSize: sz(12) },
  tagsScroll: { marginTop: sz(16), flexGrow: 0, height: sz(44) },
  tagsContent: { gap: sz(10), paddingRight: sz(16), alignItems: 'center', height: '100%' },
  pill: { paddingHorizontal: sz(16), paddingVertical: sz(8), borderRadius: sz(22), backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center' },
  // A caption for the row that follows, not a chip you can choose.
  pillLabel: { backgroundColor: 'transparent', borderColor: 'transparent', paddingLeft: 0, paddingRight: sz(4) },
  pillTxt: { color: '#FFF', fontSize: sz(13), fontWeight: '600', letterSpacing: 0.5 },
  pillLabelTxt: { color: '#9A9A9A', fontSize: sz(12), fontWeight: '600' },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: sz(20), paddingTop: sz(14), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.2)' },
  statCol: { alignItems: 'center', flex: 1 },
  statVal: { color: '#fff', fontSize: sz(20), fontWeight: '800' },
  statLbl: { color: '#aaa', fontSize: sz(11), marginTop: sz(3), textAlign: 'center' },
  statDivider: { width: StyleSheet.hairlineWidth, height: sz(32), backgroundColor: 'rgba(255,255,255,0.2)' },
  workedRow: { marginTop: sz(16), alignItems: 'flex-start', paddingRight: sz(80) },
  workedLbl: { color: '#9A9A9A', fontSize: sz(12), fontWeight: '600', marginBottom: sz(8) },
  logosContainer: { flexDirection: 'row', alignItems: 'center', gap: sz(8), flexWrap: 'wrap' },
  workedChip: {
    maxWidth: sz(130),
    paddingHorizontal: sz(12), paddingVertical: sz(6), borderRadius: sz(16),
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  workedChipTxt: { color: '#E6E6E6', fontSize: sz(12), fontWeight: '500' },
  workedMore: { color: '#9A9A9A', fontSize: sz(12), fontWeight: '600' },
});

// ─── Screen styles (identical to influencer SwipeScreen) ──────────
const ss = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: sz(20), paddingTop: sz(6), paddingBottom: sz(4) },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: sz(6) },
  logoM: { fontSize: sz(26), fontWeight: '900', color: '#FF6B2B' },
  logoWord: { fontSize: sz(22), fontWeight: '700', color: '#fff' },
  titleBlock: { paddingHorizontal: sz(20), paddingBottom: sz(12) },
  title: { color: '#fff', fontSize: sz(22), fontWeight: '700' },
  subtitle: { color: '#888', fontSize: sz(13), marginTop: sz(3) },
  stackArea: { flex: 1, marginHorizontal: sz(16), marginBottom: sz(16), position: 'relative' },
  cardWrapper: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  stamp: { position: 'absolute', top: sz(40), borderWidth: 4, borderRadius: sz(8), paddingHorizontal: sz(12), paddingVertical: sz(6), zIndex: 10, backgroundColor: 'rgba(0,0,0,0.4)' },
  likeStamp: { left: sz(40), borderColor: '#4CAF50', transform: [{ rotate: '-15deg' }] },
  likeStampTxt: { color: '#4CAF50', fontSize: sz(28), fontWeight: '900', letterSpacing: sz(2) },
  nopeStamp: { right: sz(40), borderColor: '#FF3B30', transform: [{ rotate: '15deg' }] },
  nopeStampTxt: { color: '#FF3B30', fontSize: sz(28), fontWeight: '900', letterSpacing: sz(2) },
  actionRow: { position: 'absolute', bottom: tabBarClearance(70), left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: sz(28), zIndex: 100 },
  btnPass: { width: sz(44), height: sz(44), borderRadius: sz(22), backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', boxShadow: '0px 3px 6px rgba(0,0,0,0.18)', elevation: 5 },
  btnLike: { width: sz(50), height: sz(50), borderRadius: sz(25), backgroundColor: '#FF6B2B', justifyContent: 'center', alignItems: 'center', boxShadow: '0px 4px 8px rgba(255,107,43,0.4)', elevation: 7 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyTxt: { color: '#fff', fontSize: sz(20), fontWeight: '600' },
  emptyBtn: { marginTop: sz(16), backgroundColor: '#FF6B2B', borderRadius: sz(20), paddingHorizontal: sz(24), paddingVertical: sz(10) },
  pressed: { transform: [{ scale: 0.94 }], opacity: 0.9 },
  // Match overlay
  matchOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255, 107, 43, 0.92)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 999,
  },
  matchEmoji: { fontSize: sz(64), marginBottom: sz(12) },
  matchTitle: { color: '#fff', fontSize: sz(36), fontWeight: '900', letterSpacing: -1 },
  matchSub: { color: 'rgba(255,255,255,0.85)', fontSize: sz(17), marginTop: sz(8), fontWeight: '500' },
});

