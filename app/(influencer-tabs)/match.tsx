import { SwipeScreen } from '@/screens/main/influencer/SwipeScreen';
import { useRouter } from 'expo-router';

export default function MatchRoute() {
  const router = useRouter();

  return (
    <SwipeScreen
      // The deck stays mounted underneath, so coming back keeps your place.
      onViewProfile={(id) => router.push(`/profile/${encodeURIComponent(id)}?role=brand`)}
      onNavigateToMessages={() => {
        router.replace('/(influencer-tabs)/messages');
      }}
    />
  );
}
