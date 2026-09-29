import { BrandBioInputScreen } from '@/screens/onboarding/brand/BrandBioInputScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goToStep, goBack, onboardingData } = useStepNavigation('brand-bio-input');

  return (
    <BrandBioInputScreen
      initialBio={onboardingData?.bio}
      onBack={() => goBack('brand-location')}
      onNext={(bio) => goToStep('brand-logo-upload', { bio })}
    />
  );
}
