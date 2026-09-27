import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/api/client';
import { colors } from '@/theme/colors';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { sz } from '@/theme/scale';

type User = {
  id: string;
  email: string;
  role: 'influencer' | 'brand' | 'admin';
  created_at: string;
  is_banned: boolean;
};

export default function AdminUsersScreen() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const data = await api.get<{ data: User[] }>('/api/admin/users');
      setUsers(data.data || []);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const toggleBan = async (user: User) => {
    try {
      if (user.is_banned) {
        await api.post(`/api/admin/users/${user.id}/unban`, {});
      } else {
        await api.post(`/api/admin/users/${user.id}/ban`, {});
      }
      fetchUsers();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update user status');
    }
  };

  const renderRoleBadge = (role: string | null | undefined) => {
    if (!role) {
      return (
        <View style={[styles.roleBadge, { backgroundColor: 'rgba(255, 255, 255, 0.1)' }]}>
          <Ionicons name="time" size={sz(12)} color="#9CA3AF" />
          <Text style={[styles.roleText, { color: '#9CA3AF' }]}>
            PENDING
          </Text>
        </View>
      );
    }
    
    const isBrand = role === 'brand';
    return (
      <View style={[styles.roleBadge, { backgroundColor: isBrand ? 'rgba(244, 114, 182, 0.15)' : 'rgba(96, 165, 250, 0.15)' }]}>
        <Ionicons name={isBrand ? 'business' : 'star'} size={sz(12)} color={isBrand ? '#F472B6' : '#60A5FA'} />
        <Text style={[styles.roleText, { color: isBrand ? '#F472B6' : '#60A5FA' }]}>
          {role.toUpperCase()}
        </Text>
      </View>
    );
  };

  const renderItem = ({ item }: { item: User }) => (
    <View style={styles.cardContainer}>
      <BlurView intensity={20} tint="dark" style={styles.blurCard}>
        <LinearGradient
          colors={['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.01)']}
          style={styles.cardGradient}
        >
          <View style={styles.cardHeader}>
            <View style={styles.emailContainer}>
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>{item.email.charAt(0).toUpperCase()}</Text>
              </View>
              <View>
                <Text style={styles.email} numberOfLines={1}>{item.email}</Text>
                <Text style={styles.date}>Joined: {new Date(item.created_at).toLocaleDateString()}</Text>
              </View>
            </View>
            {renderRoleBadge(item.role)}
          </View>
          
          <View style={styles.cardFooter}>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: item.is_banned ? '#EF4444' : '#10B981' }]} />
              <Text style={styles.statusText}>{item.is_banned ? 'Suspended' : 'Active'}</Text>
            </View>

            <Pressable 
              style={({ pressed }) => [
                styles.btn, 
                item.is_banned ? styles.btnUnban : styles.btnBan,
                pressed && styles.btnPressed
              ]} 
              onPress={() => toggleBan(item)}
            >
              <Text style={[styles.btnText, item.is_banned ? styles.btnUnbanText : styles.btnBanText]}>
                {item.is_banned ? 'Restore Access' : 'Suspend User'}
              </Text>
            </Pressable>
          </View>
        </LinearGradient>
      </BlurView>
    </View>
  );

  return (
    <LinearGradient colors={['#0F0F13', '#000000']} style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.headerContainer}>
          <Text style={styles.headerSubtitle}>USER DIRECTORY</Text>
          <Text style={styles.headerTitle}>User Management</Text>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: sz(50) }} />
        ) : (
          <FlatList
            data={users}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          />
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
    marginBottom: sz(10),
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
  list: {
    paddingHorizontal: sz(20),
    paddingBottom: sz(120),
  },
  cardContainer: {
    marginBottom: sz(16),
    borderRadius: sz(24),
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  blurCard: {
    flex: 1,
  },
  cardGradient: {
    padding: sz(20),
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: sz(20),
  },
  emailContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: sz(12),
  },
  avatarPlaceholder: {
    width: sz(40),
    height: sz(40),
    borderRadius: sz(20),
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: sz(12),
  },
  avatarText: {
    color: '#fff',
    fontSize: sz(18),
    fontWeight: 'bold',
  },
  email: {
    color: '#fff',
    fontSize: sz(16),
    fontWeight: '600',
    marginBottom: sz(4),
  },
  date: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: sz(12),
    fontWeight: '500',
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: sz(10),
    paddingVertical: sz(6),
    borderRadius: sz(12),
  },
  roleText: {
    fontSize: sz(10),
    fontWeight: '800',
    marginLeft: sz(4),
    letterSpacing: 0.5,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: sz(16),
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: sz(8),
    height: sz(8),
    borderRadius: sz(4),
    marginRight: sz(8),
  },
  statusText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: sz(14),
    fontWeight: '500',
  },
  btn: {
    paddingHorizontal: sz(16),
    paddingVertical: sz(8),
    borderRadius: sz(12),
    borderWidth: 1,
  },
  btnBan: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  btnUnban: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  btnPressed: {
    opacity: 0.7,
  },
  btnText: {
    fontWeight: '700',
    fontSize: sz(13),
  },
  btnBanText: {
    color: '#EF4444',
  },
  btnUnbanText: {
    color: '#10B981',
  },
});
