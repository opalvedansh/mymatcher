import { BrandCampaignUploadScreen } from '@/screens/onboarding/brand/BrandCampaignUploadScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goToStep, goBack, onboardingData } = useStepNavigation('brand-campaign-upload');

  return (
    <BrandCampaignUploadScreen
      initialPhotos={onboardingData?.photos}
      onBack={() => goBack('brand-logo-upload')}
      // Brands only add photos on this step and it starts from the saved
      // ones, so replace rather than append — coming back and continuing
      // again would otherwise save every photo twice.
      onNext={(photos) => goToStep('brand-categories', { photos })}
    />
  );
}
