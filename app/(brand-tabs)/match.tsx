import { BrandSwipeScreen } from '@/screens/main/brand/BrandSwipeScreen';
import { useRouter } from 'expo-router';

export default function MatchRoute() {
  const router = useRouter();

  return (
    <BrandSwipeScreen
      // The deck stays mounted underneath, so coming back keeps your place.
      onViewProfile={(id) => router.push(`/profile/${encodeURIComponent(id)}?role=influencer`)}
      onNavigateToMessages={() => {
        router.replace('/(brand-tabs)/messages');
      }}
    />
  );
}
