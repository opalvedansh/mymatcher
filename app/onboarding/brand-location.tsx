import { BrandLocationScreen } from '@/screens/onboarding/brand/BrandLocationScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goToStep, goBack, onboardingData } = useStepNavigation('brand-location');

  return (
    <BrandLocationScreen
      initialLocation={onboardingData?.location}
      onBack={() => goBack('brand-platforms')}
      onAllow={(location) => goToStep('brand-bio-input', { location })}
    />
  );
}
