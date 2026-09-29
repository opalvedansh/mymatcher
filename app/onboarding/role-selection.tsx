import { RoleSelectionScreen } from '@/screens/onboarding/shared/RoleSelectionScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goToStep, onboardingData, signOut } = useStepNavigation('role-selection');

  return (
    <RoleSelectionScreen
      initialRole={onboardingData?.role}
      onBack={async () => await signOut()}
      onNext={(role) => goToStep('name-input', { role })}
    />
  );
}
