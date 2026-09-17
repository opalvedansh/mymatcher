import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert
} from 'react-native';
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

type CardItem = {
  id: string;
  image: string;
  name: string;
  handle: string;
  niche: string;
  location: string;
  followers: string;
  engagement: string;
  reach: string;
  platforms: string[];
  contentTypes: string[];
  workedWith: string[];
};

// ─── Card Content ─────────────────────────────────────────────────
const CardContent = ({ item }: { item: CardItem }) => (
  <View style={card.wrapper}>
    {/* ── Photo Background ── */}
    <Image source={{ uri: item.image }} style={card.photo} />

    <LinearGradient
      colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.0)']}
      style={card.topFade}
    />
    <LinearGradient
      colors={['rgba(0,0,0,0.0)', 'rgba(14,14,14,0.8)', 'rgba(14,14,14,1)']}
      style={card.bottomFade}
    />

    {/* Verified badge + platform tags top-right */}
    <View style={card.topRight}>
      <View style={card.verifiedBadge}>
        <MaterialCommunityIcons name="check-decagram" size={14} color="#1DA1F2" />
        <Text style={card.verifiedTxt}>Verified</Text>
      </View>
    </View>

    {/* ── Info panel ── */}
    <View style={card.infoPanel}>
      {/* Name + niche + location */}
      <Text style={card.infoName}>{item.name}</Text>
      <Text style={card.infoCats}>{item.niche}</Text>
      <View style={card.locationRow}>
        <Ionicons name="location-sharp" size={14} color="#aaa" />
        <Text style={card.locationTxt}>{item.location}</Text>
      </View>

      {/* Content types */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={card.tagsScroll}
        contentContainerStyle={card.tagsContent}
      >
        <View style={[card.pill, card.pillOrange]}>
          <Text style={card.pillTxtWhite}>Creates</Text>
        </View>
        {item.contentTypes.map((t) => (
          <View key={t} style={card.pill}>
            <Text style={card.pillTxt}>{t}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Stats */}
      <View style={card.statsRow}>
        <View style={card.statCol}>
          <Text style={card.statVal}>{item.followers}</Text>
          <Text style={card.statLbl}>Followers</Text>
        </View>
        <View style={card.statDivider} />
        <View style={card.statCol}>
          <Text style={card.statVal}>{item.engagement}</Text>
          <Text style={card.statLbl}>Engagement</Text>
        </View>
        <View style={card.statDivider} />
        <View style={card.statCol}>
          <Text style={card.statVal}>{item.reach}</Text>
          <Text style={card.statLbl}>Monthly Reach</Text>
        </View>
      </View>

      {/* Worked with brands (Dummy) */}
      <View style={card.workedRow}>
        <Text style={card.workedLbl}>Worked With</Text>
        <View style={card.logosContainer}>
           <View style={card.dummyLogo}><Ionicons name="logo-apple" size={16} color="#000" /></View>
           <View style={card.dummyLogo}><Ionicons name="logo-google" size={16} color="#000" /></View>
           <View style={card.dummyLogo}><Ionicons name="logo-amazon" size={16} color="#000" /></View>
           <View style={card.dummyLogo}><Ionicons name="logo-microsoft" size={16} color="#000" /></View>
           <View style={card.dummyLogo}><Ionicons name="logo-facebook" size={16} color="#000" /></View>
        </View>
      </View>
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
  const [matchData, setMatchData] = useState<{ name: string; avatarUrl: string } | null>(null);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // ── Load feed ───────────────────────────────────────────────────
  const loadFeed = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getFeed(20, 0);
      setInfluencers(res.data as InfluencerProfile[]);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load influencers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

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
          const avatarUrl = profile.avatar_url && isValidUrl(profile.avatar_url) 
            ? profile.avatar_url 
            : 'https://images.unsplash.com/photo-1611930022073-84af31bf7093?w=800&q=80';
          setMatchData({ name: profile.name ?? 'This influencer', avatarUrl });
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

    // Preload next batch when reaching last 3
    if (currentIndex >= influencers.length - 3) {
      try {
        const next = await getFeed(10, influencers.length);
        if (next.data.length) {
          setInfluencers(prev => [...prev, ...(next.data as InfluencerProfile[])]);
        }
      } catch {/* silent */}
    }
  }, [influencers, currentIndex, translateX, translateY]);

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

  const toCardItem = (p: InfluencerProfile) => {
    let img = p.avatar_url;
    if (!isValidUrl(img)) {
      img = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&q=80';
    }

    return {
      id: p.user_id,
      image: img as string,
      name: p.name ?? 'Unknown',
      handle: `@${(p.name ?? 'user').toLowerCase().replace(/\s+/g, '')}`,
    niche: (p.categories ?? []).join(' · ') || 'Content Creator',
    location: p.location ?? '',
    followers: p.followers >= 1_000_000
      ? `${(p.followers / 1_000_000).toFixed(1)}M`
      : p.followers >= 1000 ? `${(p.followers / 1000).toFixed(0)}K` : String(p.followers),
    engagement: `${p.engagement_rate}%`,
    reach: p.avg_views >= 1_000_000
      ? `${(p.avg_views / 1_000_000).toFixed(1)}M+`
      : p.avg_views >= 1000 ? `${(p.avg_views / 1000).toFixed(0)}K+` : String(p.avg_views),
    platforms: p.platforms ?? [],
      contentTypes: p.categories ?? [],
      workedWith: [] as string[],
    };
  };

  const renderStack = () => {
    if (loading) {
      return (
        <View style={ss.empty}>
          <ActivityIndicator size="large" color="#FF6B2B" />
          <Text style={[ss.emptyTxt, { fontSize: 15, marginTop: 12 }]}>Finding influencers...</Text>
        </View>
      );
    }
    if (error) {
      return (
        <View style={ss.empty}>
          <Text style={[ss.emptyTxt, { color: '#FF3B30' }]}>⚠️ {error}</Text>
          <Pressable onPress={loadFeed} style={{ marginTop: 16, backgroundColor: '#FF6B2B', borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    if (currentIndex >= influencers.length) {
      return (
        <View style={ss.empty}>
          <Text style={ss.emptyTxt}>You've seen all influencers 🎉</Text>
          <Text style={{ color: '#888', marginTop: 8 }}>Check back later for more</Text>
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
  topFade: { position: 'absolute', top: 0, left: 0, right: 0, height: 160 },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%' },
  topRight: { position: 'absolute', top: 16, right: 16 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  verifiedTxt: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  photoText: { position: 'absolute', bottom: 0, left: 0, paddingHorizontal: 22, paddingBottom: 20 },
  handle: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '400', letterSpacing: 0.3 },
  hugeName: { color: '#fff', fontSize: 38, fontWeight: '800', marginTop: -2, letterSpacing: -0.5 },
  rule: { width: 56, height: 2, backgroundColor: '#FF6B2B', marginVertical: 10 },
  niche: { color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 19, fontWeight: '400' },
  // info panel
  infoPanel: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 130, backgroundColor: 'transparent' },
  infoName: { color: '#fff', fontSize: 28, fontWeight: '800' },
  infoCats: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 3 },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 },
  locationTxt: { color: '#ccc', fontSize: 12 },
  tagsScroll: { marginTop: 16, flexGrow: 0, height: 44 },
  tagsContent: { gap: 10, paddingRight: 16, alignItems: 'center', height: '100%' },
  pill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center' },
  pillOrange: { backgroundColor: '#FF6B2B', borderColor: '#FF6B2B', boxShadow: '0px 4px 6px rgba(255,107,43,0.3)', elevation: 4 },
  pillTxt: { color: '#FFF', fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  pillTxtWhite: { color: '#FFF', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.2)' },
  statCol: { alignItems: 'center', flex: 1 },
  statVal: { color: '#fff', fontSize: 20, fontWeight: '800' },
  statLbl: { color: '#aaa', fontSize: 11, marginTop: 3, textAlign: 'center' },
  statDivider: { width: StyleSheet.hairlineWidth, height: 32, backgroundColor: 'rgba(255,255,255,0.2)' },
  workedRow: { marginTop: 16, alignItems: 'flex-start', paddingRight: 80 },
  workedLbl: { color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 },
  logosContainer: { flexDirection: 'row', gap: 10 },
  dummyLogo: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center' },
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

