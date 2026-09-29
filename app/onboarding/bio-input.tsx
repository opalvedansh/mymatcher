import { BioInputScreen } from '@/screens/onboarding/influencer/BioInputScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goToStep, goBack, onboardingData } = useStepNavigation('bio-input');

  return (
    <BioInputScreen
      initialBio={onboardingData?.bio}
      onBack={() => goBack('location')}
      onNext={(bio) => goToStep('photos', { bio })}
    />
  );
}
