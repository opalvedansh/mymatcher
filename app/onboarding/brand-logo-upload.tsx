import { BrandLogoUploadScreen } from '@/screens/onboarding/brand/BrandLogoUploadScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goToStep, goBack, onboardingData } = useStepNavigation('brand-logo-upload');

  return (
    <BrandLogoUploadScreen
      initialLogo={onboardingData?.logo}
      onBack={() => goBack('brand-bio-input')}
      onNext={(logo) => goToStep('brand-campaign-upload', { logo })}
    />
  );
}
