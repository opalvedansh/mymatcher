import { PricePackagesScreen } from '@/screens/onboarding/influencer/PricePackagesScreen';
import { useStepNavigation } from '@/screens/onboarding/useStepNavigation';

export default function Route() {
  const { goBack, onboardingData, updateOnboarding, completeOnboarding, router } =
    useStepNavigation('price-packages');

  return (
    <PricePackagesScreen
      initialPackages={onboardingData?.packages}
      onBack={() => goBack('photos')}
      onStart={async (packages) => {
        await updateOnboarding({ packages, currentStep: 'price_packages' });
        if (await completeOnboarding()) router.replace('/(influencer-tabs)/home');
      }}
    />
  );
}
