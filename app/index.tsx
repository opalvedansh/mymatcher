import { View, ActivityIndicator, StyleSheet, Text, Pressable } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { colors } from '@/theme/colors';

// Routing is handled by AuthGuard in app/_layout.tsx; this is what the user
// sees while auth state resolves, or when it failed to load.
export default function Index() {
  const { loading, userDataError, retryUserData, signOut } = useAuth();

  if (userDataError && !loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{userDataError}</Text>
        <Pressable style={styles.button} onPress={retryUserData}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
        <Pressable style={styles.link} onPress={signOut}>
          <Text style={styles.text}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.text}>Loading Matchr...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  text: {
    color: '#8A8A8A',
    fontSize: 16,
    marginTop: 16,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 16,
    textAlign: 'center',
  },
  button: {
    marginTop: 24,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  link: {
    marginTop: 8,
  },
});
