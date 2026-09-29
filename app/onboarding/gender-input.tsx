import { GenderSelectionScreen } from '@/screens/onboarding/influencer/GenderSelectionScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goToStep, goBack, onboardingData } = useStepNavigation('gender-input');

  return (
    <GenderSelectionScreen
      initialGender={onboardingData?.gender}
      onBack={() => goBack('dob-input')}
      onNext={(gender) => goToStep('social-platforms', { gender: gender ?? '' })}
    />
  );
}
