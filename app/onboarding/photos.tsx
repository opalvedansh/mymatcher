import { PhotoUploadScreen } from '@/screens/onboarding/influencer/PhotoUploadScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goToStep, goBack, onboardingData } = useStepNavigation('photos');

  return (
    <PhotoUploadScreen
      initialPhotos={onboardingData?.photos}
      onBack={() => goBack('bio-input')}
      onNext={(photos) => goToStep('price-packages', { photos })}
    />
  );
}
