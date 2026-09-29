import { BrandCategorySelectionScreen } from '@/screens/onboarding/brand/BrandCategorySelectionScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goBack, onboardingData, updateOnboarding, completeOnboarding, router } =
    useStepNavigation('brand-categories');

  return (
    <BrandCategorySelectionScreen
      initialCategories={onboardingData?.categories}
      onBack={() => goBack('brand-campaign-upload')}
      onNext={async (categories) => {
        await updateOnboarding({ categories, currentStep: 'brand_categories' });
        if (await completeOnboarding()) router.replace('/(brand-tabs)/home');
      }}
    />
  );
}
