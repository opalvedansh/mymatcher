import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons, AntDesign } from '@expo/vector-icons';
import { colors } from '@/theme/colors';
import { getMapAutocomplete, getMapGeocode } from '@/api';
import { DismissKeyboard } from '@/components/DismissKeyboard';



export interface LocationResult {
  name: string;  // Human-readable place name, e.g. "Mumbai, Maharashtra, India"
  lat: number;
  lng: number;
}

interface Prediction {
  place_id: string;
  description: string;
}

interface Props {
  initialValue?: LocationResult | null;
  onSelect: (location: LocationResult) => void;
  onBack?: () => void;
}

export function LocationPicker({ initialValue, onSelect, onBack }: Props) {
  const [query, setQuery] = useState(initialValue?.name ?? '');
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [selected, setSelected] = useState<LocationResult | null>(initialValue ?? null);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch autocomplete predictions as user types
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!trimmed || trimmed === selected?.name) {
      setPredictions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {

      setLoading(true);
      try {
        const res = await getMapAutocomplete(trimmed, '(cities)');
        setPredictions(res.predictions ?? []);
      } catch (err) {
        console.error('[LocationPicker] Autocomplete error:', err);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Resolve a place_id to lat/lng using the Geocoding API
  const handleSelect = async (prediction: Prediction) => {
    setPredictions([]);
    setQuery(prediction.description);
    setResolving(true);

    try {
      const res = await getMapGeocode(prediction.place_id);
      const result = res.results?.[0];

      if (result) {
        const { lat, lng } = result.geometry.location;
        const location: LocationResult = {
          name: prediction.description,
          lat,
          lng,
        };
        setSelected(location);
      }
    } catch (err) {
      console.error('[LocationPicker] Geocoding error:', err);
    } finally {
      setResolving(false);
    }
  };

  const handleConfirm = () => {
    Keyboard.dismiss();
    if (selected) {
      onSelect(selected);
    } else if (query.trim().length > 0) {
      // Fallback: If no place is selected but text is entered, use the text
      onSelect({
        name: query.trim(),
        lat: 0, // Fallback lat
        lng: 0, // Fallback lng
      });
    }
  };

  const isReady = (!!selected || query.trim().length > 0) && !resolving;

  return (
    <DismissKeyboard>
      <View style={styles.container}>
      {/* Back Button */}
      {onBack && (
        <Pressable onPress={onBack} style={styles.backButton}>
          <AntDesign name="arrow-left" size={24} color={colors.text} />
        </Pressable>
      )}

      {/* Header Text */}
      <View style={styles.headerText}>
        <Text style={styles.title}>Enter your{'\n'}location</Text>
        <Text style={styles.subtitle}>
          Search for your city so we can connect you with nearby{' '}
          {/* context is inferred by the parent */}
          partners.
        </Text>
      </View>

      {/* Search Input */}
      <View style={styles.searchWrapper}>
        <Ionicons name="search" size={18} color="#888" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search city or area…"
          placeholderTextColor="#666"
          value={query}
          onChangeText={(t) => {
            setSelected(null);
            setQuery(t);
          }}
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="search"
        />
        {loading && (
          <ActivityIndicator size="small" color={colors.primary} style={styles.searchSpinner} />
        )}
        {query.length > 0 && !loading && (
          <Pressable onPress={() => { setQuery(''); setSelected(null); setPredictions([]); }}>
            <AntDesign name="close" size={16} color="#666" style={styles.clearIcon} />
          </Pressable>
        )}
      </View>

      {/* Predictions Dropdown */}
      {predictions.length > 0 && (
        <View style={styles.dropdown}>
          <FlatList
            data={predictions}
            keyExtractor={(item) => item.place_id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.predictionItem, pressed && styles.predictionItemPressed]}
                onPress={() => handleSelect(item)}
              >
                <Ionicons name="location-outline" size={16} color={colors.primary} style={styles.predictionIcon} />
                <Text style={styles.predictionText} numberOfLines={2}>
                  {item.description}
                </Text>
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </View>
      )}

      {/* Selected Location Confirmation */}
      {selected && (
        <View style={styles.selectedCard}>
          <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
          <View style={styles.selectedTextBlock}>
            <Text style={styles.selectedLabel}>Selected Location</Text>
            <Text style={styles.selectedName} numberOfLines={2}>{selected.name}</Text>
            <Text style={styles.selectedCoords}>
              {selected.lat.toFixed(4)}°, {selected.lng.toFixed(4)}°
            </Text>
          </View>
        </View>
      )}

      {resolving && (
        <View style={styles.resolvingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.resolvingText}>Getting coordinates…</Text>
        </View>
      )}

      {/* Spacer */}
      <View style={{ flex: 1 }} />

      {/* Confirm Button */}
      <Pressable
        style={[styles.confirmButton, !isReady && styles.confirmButtonDisabled]}
        onPress={handleConfirm}
        disabled={!isReady}
      >
        <Text style={styles.confirmButtonText}>
          {isReady ? 'Confirm Location' : 'Search or enter a location'}
        </Text>
      </Pressable>
      </View>
    </DismissKeyboard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    backgroundColor: colors.background,
  },
  backButton: {
    marginBottom: 24,
  },
  headerText: {
    marginBottom: 28,
  },
  title: {
    color: colors.text,
    fontSize: 40,
    fontWeight: '700',
    lineHeight: 44,
    marginBottom: 12,
  },
  subtitle: {
    color: '#8A8A8A',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    paddingRight: 20,
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 14,
    height: 52,
    marginBottom: 4,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    height: '100%',
  },
  searchSpinner: {
    marginLeft: 8,
  },
  clearIcon: {
    marginLeft: 8,
    padding: 4,
  },
  dropdown: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    marginTop: 4,
    marginBottom: 8,
    maxHeight: 240,
    overflow: 'hidden',
  },
  predictionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  predictionItemPressed: {
    backgroundColor: '#252525',
  },
  predictionIcon: {
    marginRight: 10,
    marginTop: 2,
  },
  predictionText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  separator: {
    height: 1,
    backgroundColor: '#2A2A2A',
    marginHorizontal: 16,
  },
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primary + '44',
    padding: 16,
    marginTop: 16,
    gap: 12,
  },
  selectedTextBlock: {
    flex: 1,
  },
  selectedLabel: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  selectedName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 4,
  },
  selectedCoords: {
    color: '#666',
    fontSize: 11,
  },
  resolvingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    paddingHorizontal: 4,
  },
  resolvingText: {
    color: '#888',
    fontSize: 13,
  },
  confirmButton: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  confirmButtonDisabled: {
    backgroundColor: '#333',
  },
  confirmButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
