import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect } from 'react';

// Owns every auth-driven redirect. This lives in the root layout because it
// must stay mounted across the sign-in transition — a screen that routes itself
// away (as app/index.tsx used to) unmounts and stops observing auth state.
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, onboardingComplete, onboardingData, userDataError } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;

    const group = segments[0];
    const inAuthGroup = group === 'auth';
    const inOnboarding = group === 'onboarding';

    if (!user) {
      if (!inAuthGroup) router.replace('/auth/login');
      return;
    }

    // Without their saved state we can't know where they belong; the index
    // screen offers a retry instead of dropping them at role selection.
    if (userDataError) {
      if (group !== undefined) router.replace('/');
      return;
    }

    if (!onboardingComplete) {
      // Only steer them into onboarding from outside it. `currentStep` trails
      // the screen they are actually on, so redirecting while already inside
      // would pin them to an earlier step.
      if (!inOnboarding) {
        const step = (onboardingData?.currentStep || 'role_selection').replace(/_/g, '-');
        router.replace(`/onboarding/${step}`);
      }
      return;
    }

    if (inAuthGroup || inOnboarding || group === undefined) {
      router.replace(onboardingData?.role === 'Brand' ? '/(brand-tabs)/home' : '/(influencer-tabs)/home');
    }
  }, [user, loading, onboardingComplete, onboardingData, userDataError, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <AuthGuard>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="story-camera" options={{ presentation: 'fullScreenModal', headerShown: false }} />
          </Stack>
        </AuthGuard>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
