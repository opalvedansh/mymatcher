import { Tabs } from 'expo-router';
import { TAB_BAR_STYLE } from '@/theme/tabBar';
import { NavHomeIcon, NavMatchIcon, NavHeartIcon, NavMessageIcon, NavProfileIcon } from '@/components/BottomNavIcons';

export default function InfluencerTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: TAB_BAR_STYLE,
        tabBarItemStyle: {
          height: 55,
          paddingTop: 8,
          // @ts-ignore
          outlineStyle: 'none' as any,
          // @ts-ignore
          outlineWidth: 0,
          borderWidth: 0,
        },
        tabBarActiveTintColor: '#FF6B2B',
        tabBarInactiveTintColor: '#666',
        tabBarShowLabel: false,
      }}
      initialRouteName="match"
    >
      <Tabs.Screen
        name="match"
        options={{
          title: 'Match',
          tabBarIcon: ({ color, size }) => <NavMatchIcon size={24} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <NavHomeIcon size={24} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="likes"
        options={{
          title: 'Likes',
          tabBarIcon: ({ color, size }) => <NavHeartIcon size={26} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color, size }) => <NavMessageIcon size={24} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <NavProfileIcon size={24} color={color as string} />,
        }}
      />
    </Tabs>
  );
}
