import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme/colors';
import { LocationPicker, type LocationResult } from '@/components/LocationPicker';

export function BrandLocationScreen({
  onBack,
  onAllow,
}: {
  onBack?: () => void;
  onAllow?: (location: LocationResult) => void;
}) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <LocationPicker
        onBack={onBack}
        onSelect={(location) => onAllow?.(location)}
      />
    </SafeAreaView>
  );
}
