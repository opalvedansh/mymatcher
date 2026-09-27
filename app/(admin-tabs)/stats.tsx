import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/api/client';
import { colors } from '@/theme/colors';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { sz } from '@/theme/scale';

const { width } = Dimensions.get('window');

type Stats = {
  total_users: string;
  total_brands: string;
  total_influencers: string;
  banned_users: string;
  active_matches: string;
  total_swipes: string;
  total_messages: string;
};

export default function AdminStatsScreen() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const data = await api.get<Stats>('/api/admin/stats');
      setStats(data);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to fetch stats');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const formatNumber = (num: string | undefined) => {
    if (!num) return '0';
    return parseInt(num, 10).toLocaleString();
  };

  const statConfig = [
    { key: 'total_users', label: 'Total Users', icon: 'people' as const, color: '#4ADE80' },
    { key: 'total_brands', label: 'Brands', icon: 'business' as const, color: '#F472B6' },
    { key: 'total_influencers', label: 'Influencers', icon: 'star' as const, color: '#60A5FA' },
    { key: 'banned_users', label: 'Banned Users', icon: 'ban' as const, color: '#F87171' },
    { key: 'active_matches', label: 'Active Matches', icon: 'heart' as const, color: '#FF2A5F' },
    { key: 'total_swipes', label: 'Total Swipes', icon: 'albums' as const, color: '#A78BFA' },
    { key: 'total_messages', label: 'Messages', icon: 'chatbubbles' as const, color: '#34D399' },
  ];

  const renderStatCard = (config: typeof statConfig[0], value: string | undefined, index: number) => {
    const isFullWidth = index === 0;
    
    return (
      <View key={config.key} style={[styles.cardContainer, isFullWidth && styles.fullWidthCard]}>
        <BlurView intensity={20} tint="dark" style={styles.blurCard}>
          <LinearGradient
            colors={['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.01)']}
            style={styles.cardGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={[styles.iconContainer, { backgroundColor: config.color + '20' }]}>
              <Ionicons name={config.icon} size={sz(24)} color={config.color} />
            </View>
            <Text style={styles.cardValue}>{formatNumber(value)}</Text>
            <Text style={styles.cardTitle}>{config.label}</Text>
          </LinearGradient>
        </BlurView>
      </View>
    );
  };

  return (
    <LinearGradient colors={['#0F0F13', '#000000']} style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.headerContainer}>
          <Text style={styles.headerSubtitle}>COMMAND CENTER</Text>
          <Text style={styles.headerTitle}>App Statistics</Text>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: sz(50) }} />
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.grid}>
              {statConfig.map((config, index) => 
                renderStatCard(config, stats?.[config.key as keyof Stats], index)
              )}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  headerContainer: {
    paddingHorizontal: sz(24),
    marginTop: sz(20),
    marginBottom: sz(20),
  },
  headerSubtitle: {
    fontSize: sz(12),
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: sz(1.5),
    marginBottom: sz(4),
  },
  headerTitle: {
    fontSize: sz(32),
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -0.5,
  },
  scroll: {
    paddingHorizontal: sz(20),
    paddingBottom: sz(120),
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  cardContainer: {
    width: (width - sz(56)) / 2, // 20 padding on sides + 16 gap
    height: sz(160),
    marginBottom: sz(16),
    borderRadius: sz(24),
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  fullWidthCard: {
    width: '100%',
    height: sz(140),
  },
  blurCard: {
    flex: 1,
  },
  cardGradient: {
    flex: 1,
    padding: sz(20),
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
  },
  iconContainer: {
    position: 'absolute',
    top: sz(20),
    right: sz(20),
    width: sz(44),
    height: sz(44),
    borderRadius: sz(22),
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardValue: {
    color: '#fff',
    fontSize: sz(32),
    fontWeight: '900',
    letterSpacing: -1,
    marginBottom: sz(4),
  },
  cardTitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: sz(14),
    fontWeight: '600',
  },
});
