import { SocialPlatformSelectionScreen } from '@/screens/onboarding/influencer/SocialPlatformSelectionScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goToStep, goBack, onboardingData } = useStepNavigation('social-platforms');

  return (
    <SocialPlatformSelectionScreen
      initialPlatforms={onboardingData?.platforms}
      onBack={() => goBack('gender-input')}
      onNext={(platforms) => goToStep('categories', { platforms })}
    />
  );
}
