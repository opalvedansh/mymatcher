import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ActionSheetHost } from '@/components/ActionSheet';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { pushDataOf, pushSupported } from '@/services/pushNotifications';
import { notificationHref } from '@/services/notificationRoutes';
import { refreshUnreadNotifications } from '@/hooks/useUnreadNotifications';
import { setPendingDeepLink, takePendingDeepLink } from '@/services/pendingDeepLink';

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
      if (!inAuthGroup) {
        // A shared post link normally opens with no session. Remember where it
        // was headed so sign-in can finish the trip instead of dropping them
        // on the home feed.
        setPendingDeepLink('/' + segments.join('/'));
        router.replace('/auth/login');
      }
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

    const isBrand = onboardingData?.role === 'Brand';
    // Also catch the other role's tab group: on web both groups share URLs
    // (/profile, /home, ...), so a reload can resolve into the wrong one.
    const inWrongTabs = group === (isBrand ? '(influencer-tabs)' : '(brand-tabs)');

    if (inAuthGroup || inOnboarding || group === undefined || inWrongTabs) {
      // Home first, so the parked screen has a feed to go back to.
      router.replace(isBrand ? '/(brand-tabs)/home' : '/(influencer-tabs)/home');
      const pending = takePendingDeepLink();
      if (pending) router.push(pending as never);
    }
  }, [user, loading, onboardingComplete, onboardingData, userDataError, segments, router]);

  return <>{children}</>;
}

// Opens the right screen when a push notification is tapped, including the
// one that launched the app. Waits until the user is signed in and set up.
function PushResponseHandler() {
  const { user, loading, onboardingComplete, onboardingData } = useAuth();
  const router = useRouter();
  const handled = useRef(new Set<string>());
  const ready = !!user && !loading && onboardingComplete && !!onboardingData?.role;
  const role = onboardingData?.role;

  useEffect(() => {
    if (!pushSupported || !ready) return;

    const open = (response: Notifications.NotificationResponse | null) => {
      const data = pushDataOf(response);
      const id = response?.notification.request.identifier;
      if (!data || !id || handled.current.has(id)) return;
      handled.current.add(id);
      refreshUnreadNotifications();
      router.navigate(notificationHref(role, data.type, data.matchId));
    };

    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [ready, role, router]);

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <AuthGuard>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="story-camera" options={{ presentation: 'fullScreenModal', headerShown: false }} />
            <Stack.Screen name="notifications" options={{ headerShown: false, animation: 'slide_from_right' }} />
            <Stack.Screen name="profile/[id]" options={{ headerShown: false, animation: 'slide_from_right' }} />
            <Stack.Screen name="p/[id]" options={{ headerShown: false, animation: 'slide_from_right' }} />
          </Stack>
          <ActionSheetHost />
          <PushResponseHandler />
        </AuthGuard>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
