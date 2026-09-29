import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { BrandCategorySelectionScreen } from '@/screens/onboarding/brand/BrandCategorySelectionScreen';

export default function Route() {
  const router = useRouter();
  const { updateOnboarding, completeOnboarding, onboardingData, signOut } = useAuth();

  const goToStep = async (nextRoute: string, data?: Record<string, any>) => {
    // Map dashed routes back to underscore step names for the database
    const stepName = nextRoute.replace(/-/g, '_');
    await updateOnboarding({ currentStep: stepName, ...data });
    router.push(`/onboarding/${nextRoute}`);
  };

  return (
    <BrandCategorySelectionScreen
      onBack={() => goToStep('brand-campaign-upload')}
      onNext={async (categories) => {
        await updateOnboarding({ categories, currentStep: 'brand_categories' });
        if (await completeOnboarding()) router.replace('/(brand-tabs)/home');
      }}
    />
  );
}
