import { NameInputScreen } from '@/screens/onboarding/shared/NameInputScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goToStep, goBack, onboardingData } = useStepNavigation('name-input');

  return (
    <NameInputScreen
      role={onboardingData?.role || 'Influencer'}
      initialName={onboardingData?.name}
      initialInstagramId={onboardingData?.instagramUsername}
      onBack={() => goBack('role-selection')}
      onNext={(name, instagramUsername) => {
        if (onboardingData?.role === 'Influencer' || !onboardingData?.role) {
          goToStep('dob-input', { name, instagramUsername });
        } else {
          goToStep('brand-platforms', { name, instagramUsername });
        }
      }}
    />
  );
}
