import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { getProfileById } from '@/api';
import { useAuth } from '@/contexts/AuthContext';
import { BrandProfileScreen } from '@/screens/main/brand/BrandProfileScreen';
import { InfluencerProfileScreen } from '@/screens/main/influencer/InfluencerProfileScreen';
import type { UserRole } from '@/api/types';

const ACCENT = '#FF6B2B';

/**
 * Someone else's profile, opened from a swipe card.
 *
 * The caller passes `role` because it already knows it (a brand only ever
 * swipes creators, and the other way round), which saves a request. A link
 * that arrives without it — a deep link, say — resolves the role first.
 */
export default function PublicProfileRoute() {
  const { id, role: roleParam } = useLocalSearchParams<{ id: string; role?: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const known = roleParam === 'brand' || roleParam === 'influencer' ? (roleParam as UserRole) : null;
  const [role, setRole] = useState<UserRole | null>(known);
  const [failed, setFailed] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  useEffect(() => {
    if (role || !id) return;
    let cancelled = false;
    (async () => {
      try {
        const profile = await getProfileById(id);
        if (!cancelled) setRole(profile.role);
      } catch (err) {
        // A blocked or deleted account answers 404 here, by design.
        console.warn('Could not open profile', err);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [id, role]);

  if (!id || failed) {
    return (
      <SafeAreaView style={styles.centre}>
        <Ionicons name="person-circle-outline" size={44} color="#4A4A4A" />
        <Text style={styles.message}>This profile is not available.</Text>
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonTxt}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!role) {
    return (
      <SafeAreaView style={styles.centre}>
        <ActivityIndicator size="large" color={ACCENT} />
      </SafeAreaView>
    );
  }

  // Your own link opens your own profile, not a stranger's view of it.
  const isMe = !!user?.id && user.id === id;

  return role === 'brand' ? (
    <BrandProfileScreen publicUserId={isMe ? undefined : id} onBack={goBack} />
  ) : (
    <InfluencerProfileScreen publicUserId={isMe ? undefined : id} onBack={goBack} />
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', gap: 14 },
  message: { color: '#9A9A9A', fontSize: 15 },
  button: {
    marginTop: 6,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  buttonTxt: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
