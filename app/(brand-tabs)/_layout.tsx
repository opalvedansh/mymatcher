import { Tabs } from 'expo-router';
import { TAB_BAR_STYLE } from '@/theme/tabBar';
import { NavHomeIcon, NavMatchIcon, NavHeartIcon, NavMessageIcon, NavProfileIcon } from '@/components/BottomNavIcons';
import { sz } from '@/theme/scale';

export default function BrandTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: TAB_BAR_STYLE,
        // Fills the item's height so the icon sits centered in the pill.
        tabBarIconStyle: { flex: 1 },
        tabBarItemStyle: {
          // @ts-ignore
          outlineStyle: 'none' as any,
          // @ts-ignore
          outlineWidth: 0,
          borderWidth: 0,
        },
        tabBarActiveTintColor: '#FF6B2B',
        tabBarInactiveTintColor: '#666',
        // Icons only, so each screen sets tabBarAccessibilityLabel for screen readers.
        tabBarShowLabel: false,
        // Hidden tabs stop re-rendering on context and socket updates.
        freezeOnBlur: true,
      }}
      // Sign-in lands on home, so Android back from another tab returns there.
      initialRouteName="home"
      backBehavior="initialRoute"
    >
      <Tabs.Screen
        name="match"
        options={{
          title: 'Match',
          tabBarAccessibilityLabel: 'Match',
          tabBarIcon: ({ color, size }) => <NavMatchIcon size={sz(24)} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarAccessibilityLabel: 'Home',
          tabBarIcon: ({ color, size }) => <NavHomeIcon size={sz(24)} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="likes"
        options={{
          title: 'Likes',
          tabBarAccessibilityLabel: 'Likes',
          tabBarIcon: ({ color, size }) => <NavHeartIcon size={sz(26)} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarAccessibilityLabel: 'Messages',
          tabBarIcon: ({ color, size }) => <NavMessageIcon size={sz(24)} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarAccessibilityLabel: 'Profile',
          tabBarIcon: ({ color, size }) => <NavProfileIcon size={sz(24)} color={color as string} />,
        }}
      />
    </Tabs>
  );
}
