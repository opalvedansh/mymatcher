import { BrandPlatformSelectionScreen } from '@/screens/onboarding/brand/BrandPlatformSelectionScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goToStep, goBack, onboardingData } = useStepNavigation('brand-platforms');

  return (
    <BrandPlatformSelectionScreen
      initialPlatforms={onboardingData?.platforms}
      onBack={() => goBack('name-input')}
      onNext={(platforms) => goToStep('brand-location', { platforms })}
    />
  );
}
