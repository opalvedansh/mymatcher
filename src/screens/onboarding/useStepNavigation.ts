import { useCallback, useRef } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import type { OnboardingData } from '@/contexts/AuthContext';

// Shared by every onboarding route. `step` is this route's dashed name (e.g.
// 'bio-input'); it's written back as `currentStep` whenever the screen gains
// focus, so the resume point stays right after Back or an iOS swipe-back too.
export function useStepNavigation(step: string) {
  const router = useRouter();
  const auth = useAuth();
  const { updateOnboarding } = auth;

  // updateOnboarding is recreated every render; the focus effect reads the
  // latest through refs so it only runs on focus.
  const latest = useRef({ updateOnboarding, currentStep: auth.onboardingData?.currentStep });
  latest.current = { updateOnboarding, currentStep: auth.onboardingData?.currentStep };

  // Blocks a double tap (or Return + tap) from pushing the next step twice.
  // Cleared when this screen is focused again, e.g. after coming back to it.
  const navigating = useRef(false);

  useFocusEffect(
    useCallback(() => {
      navigating.current = false;
      const stepName = step.replace(/-/g, '_');
      if (latest.current.currentStep !== stepName) {
        latest.current.updateOnboarding({ currentStep: stepName }).catch(() => {});
      }
    }, [step]),
  );

  const goToStep = async (nextRoute: string, data?: Partial<OnboardingData>) => {
    if (navigating.current) return;
    navigating.current = true;
    try {
      // Map dashed routes back to underscore step names for the database
      await updateOnboarding({ currentStep: nextRoute.replace(/-/g, '_'), ...data });
      router.push(`/onboarding/${nextRoute}` as never);
    } catch (e) {
      navigating.current = false;
      throw e;
    }
  };

  // Pop back to the previous step instead of pushing it again, so the stack
  // doesn't grow and swipe-back keeps going the right way. After a cold
  // resume there's nothing underneath, so swap in the previous step.
  const goBack = (prevRoute: string) => {
    if (router.canGoBack()) router.back();
    else router.replace(`/onboarding/${prevRoute}` as never);
  };

  return { ...auth, router, goToStep, goBack };
}
