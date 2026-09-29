import { Stack } from 'expo-router';
import { View } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { colors } from '@/theme/colors';

export default function Layout() {
  const { onboardingData } = useAuth();
  // Steps seed their fields from saved progress when they mount. On a web
  // reload that data arrives after the route renders, and a step seeded empty
  // would then overwrite what was saved.
  if (!onboardingData) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
