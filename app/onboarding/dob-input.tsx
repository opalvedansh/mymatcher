import { DateOfBirthScreen } from '@/screens/onboarding/influencer/DateOfBirthScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goToStep, goBack, onboardingData } = useStepNavigation('dob-input');

  return (
    <DateOfBirthScreen
      initialDob={onboardingData?.dob}
      onBack={() => goBack('name-input')}
      onNext={(dob) => goToStep('gender-input', { dob })}
    />
  );
}
