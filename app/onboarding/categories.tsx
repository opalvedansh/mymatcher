import { CategorySelectionScreen } from '@/screens/onboarding/influencer/CategorySelectionScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goToStep, goBack, onboardingData } = useStepNavigation('categories');

  return (
    <CategorySelectionScreen
      initialCategories={onboardingData?.categories}
      onBack={() => goBack('social-platforms')}
      onNext={(categories) => goToStep('location', { categories })}
    />
  );
}
