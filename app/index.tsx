import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { colors } from '@/theme/colors';

// Routing is handled by AuthGuard in app/_layout.tsx; this is just what the
// user sees while auth state resolves.
export default function Index() {
  return (
    <View style={loadingStyles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={loadingStyles.text}>Loading Matchr...</Text>
    </View>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#8A8A8A',
    fontSize: 16,
    marginTop: 16,
  },
});
