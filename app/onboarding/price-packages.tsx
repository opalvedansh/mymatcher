import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { PricePackagesScreen } from '@/screens/onboarding/influencer/PricePackagesScreen';

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
    <PricePackagesScreen
      onBack={() => goToStep('photos')}
      onStart={async (packages) => {
        await updateOnboarding({ packages, currentStep: 'price_packages' });
        if (await completeOnboarding()) router.replace('/(influencer-tabs)/home');
      }}
    />
  );
}
