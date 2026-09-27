import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications';
import { sz } from '@/theme/scale';

/** Header bell: opens the notifications inbox and shows the unread count. */
export function NotificationBell({ color = '#FFF' }: { color?: string }) {
  const router = useRouter();
  const count = useUnreadNotifications();
  const label = count > 0 ? `Notifications, ${count} unread` : 'Notifications';

  return (
    <Pressable
      onPress={() => router.push('/notifications')}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name="notifications" size={sz(24)} color={color} />
      {count > 0 && (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { padding: sz(2) },
  badge: {
    position: 'absolute',
    top: sz(-4),
    right: sz(-6),
    minWidth: sz(18),
    height: sz(18),
    borderRadius: sz(9),
    paddingHorizontal: sz(4),
    backgroundColor: '#FF6B2B',
    borderWidth: 2,
    borderColor: '#121212',
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: { color: '#FFF', fontSize: sz(10), fontWeight: '700', lineHeight: sz(12) },
});
