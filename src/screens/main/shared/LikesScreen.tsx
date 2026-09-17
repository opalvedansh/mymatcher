import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  Pressable,
  Image,
  ScrollView,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getMatches, getLikesReceived } from '@/api';
import type { MatchRecord } from '@/api/types';
import { useAuth } from '@/contexts/AuthContext';
import { NotificationBell } from '@/components/NotificationBell';

const GRID_SPACING = 16;

type MixedRecord = {
  id: string;
  type: 'match' | 'like';
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

const formatNum = (num: number) => {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(0)}k`;
  return String(num || 0);
};

export function LikesScreen() {
  const { width } = useWindowDimensions();
  const { onboardingData, user } = useAuth();
  const role = onboardingData?.role?.toLowerCase() as 'brand' | 'influencer' | undefined;

  const [items, setItems] = useState<MixedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ITEM_WIDTH = (width - 24 * 2 - GRID_SPACING) / 2;
  const isPremium = user?.email === 'vedanshlovesmom88@gmail.com';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [matchesRes, likesRes] = await Promise.all([
          getMatches().catch(() => ({ data: [] })),
          getLikesReceived().catch(() => ({ data: [] }))
        ]) as any[];

        const matchesData = matchesRes?.data || matchesRes || [];
        const likesData = likesRes?.data || likesRes || [];

        const formattedMatches: MixedRecord[] = matchesData.map((m: any) => ({
          id: m.match_id,
          type: 'match',
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

        if (!cancelled) setItems([...formattedMatches, ...formattedLikes]);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? 'Failed to load likes');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Likes</Text>
          <NotificationBell />
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#FF6B2B" />
            <Text style={styles.loadingTxt}>Loading your likes...</Text>
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Text style={[styles.emptyTitle, { color: '#FF3B30' }]}>⚠️ {error}</Text>
          </View>
        ) : (
          <>
            {/* Premium Banner */}
            <View style={styles.premiumBanner}>
              <View style={styles.heartCircle}>
                <Ionicons name="heart" size={24} color="#FF6B2B" />
              </View>
              <Text style={styles.premiumTitle}>View your likes</Text>
              <Text style={styles.premiumSubtitle}>
                Activate Matchr Premium and see the people whose likes you already have.
              </Text>
              <Pressable style={styles.premiumBtn}>
                <Text style={styles.premiumBtnText}>Activate Premium</Text>
              </Pressable>
            </View>

            {/* Grid */}
            <View style={styles.gridContainer}>
              {(items.length > 0 ? items : [1, 2, 3, 4]).map((item, idx) => {
                const isDummy = typeof item === 'number';
                const record = isDummy ? null : (item as MixedRecord);
                const imageUrl = record?.avatar || `https://picsum.photos/seed/${idx + 10}/400/600`;
                
                // Blur if dummy, OR if it's a 'like' and user doesn't have premium
                const shouldBlur = isDummy || (!isPremium && record?.type === 'like');

                return (
                  <View
                    key={isDummy ? `dummy-${item}` : record!.id}
                    style={[styles.gridItem, { width: ITEM_WIDTH, height: ITEM_WIDTH * 1.55 }]}
                  >
                    <Image
                      source={{ uri: imageUrl }}
                      style={styles.matchImage}
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
                            <Ionicons name="location-sharp" size={10} color="#aaa" />
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
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#121212' },
  scrollContent: { paddingBottom: 100 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, marginTop: 20, marginBottom: 16,
  },
  headerTitle: { fontSize: 34, fontWeight: 'bold', color: '#FFF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32 },
  loadingTxt: { color: '#888', marginTop: 12, fontSize: 14 },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: '#FFF', textAlign: 'center' },
  emptySub: { fontSize: 14, color: '#888', textAlign: 'center', marginTop: 10, lineHeight: 21 },
  countLabel: { color: '#888', fontSize: 13, paddingHorizontal: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.8 },
  premiumBanner: { alignItems: 'center', paddingHorizontal: 32, marginTop: 10, marginBottom: 30 },
  heartCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  premiumTitle: { color: '#FFF', fontSize: 20, fontWeight: '700', marginBottom: 10 },
  premiumSubtitle: { color: '#FFF', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  premiumBtn: { backgroundColor: '#FFF', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 24 },
  premiumBtnText: { color: '#000', fontSize: 14, fontWeight: '700' },
  gridContainer: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 24, gap: GRID_SPACING, justifyContent: 'space-between',
  },
  gridItem: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#222', justifyContent: 'flex-end' },
  matchImage: { position: 'absolute', width: '100%', height: '100%', resizeMode: 'cover' },
  avatarPlaceholder: { backgroundColor: '#2A2A2A', justifyContent: 'center', alignItems: 'center' },
  avatarInitial: { fontSize: 40, fontWeight: '700', color: '#FF6B2B' },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '70%' },
  infoPanel: { paddingHorizontal: 12, paddingBottom: 14, backgroundColor: 'transparent' },
  infoName: { color: '#fff', fontSize: 16, fontWeight: '800' },
  infoCats: { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2 },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 },
  locationTxt: { color: '#ccc', fontSize: 10 },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.2)' },
  statCol: { alignItems: 'center', flex: 1 },
  statVal: { color: '#fff', fontSize: 12, fontWeight: '800' },
  statLbl: { color: '#aaa', fontSize: 9, marginTop: 2, textAlign: 'center', textTransform: 'uppercase' },
  statDivider: { width: StyleSheet.hairlineWidth, height: 20, backgroundColor: 'rgba(255,255,255,0.2)' },
});
