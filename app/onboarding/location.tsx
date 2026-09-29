import { LocationEntryScreen } from '@/screens/onboarding/influencer/LocationEntryScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goToStep, goBack, onboardingData } = useStepNavigation('location');

  return (
    <LocationEntryScreen
      initialLocation={onboardingData?.location}
      onBack={() => goBack('categories')}
      onAllow={(location) => goToStep('bio-input', { location })}
    />
  );
}
