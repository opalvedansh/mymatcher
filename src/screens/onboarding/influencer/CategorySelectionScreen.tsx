import { useState } from 'react';
import { AntDesign } from '@expo/vector-icons';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme/colors';
import { sz } from '@/theme/scale';
import { tapFeedback } from '@/utils/optionalModules';

const CATEGORIES = [
  'Lifestyle', 'Fashion', 'Beauty', 'Fitness',
  'Food', 'Travel', 'Tech', 'Gaming',
  'Finance', 'Business', 'Education', 'Comedy',
  'Photography', 'Music', 'Automotive', 'Luxury',
  'Pets', 'Sustainability', 'Reviews', 'UGC',
  'Art', 'Spirituality', 'Vlogs', 'Events',
];

export function CategorySelectionScreen({
  initialCategories,
  onBack,
  onNext,
}: {
  initialCategories?: string[];
  onBack?: () => void;
  onNext?: (categories: string[]) => void;
}) {
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    () => new Set((initialCategories ?? []).filter((c) => CATEGORIES.includes(c))),
  );

  const toggleCategory = (category: string) => {
    const newSelected = new Set(selectedCategories);
    if (newSelected.has(category)) {
      newSelected.delete(category);
    } else {
      if (newSelected.size >= 10) {
        return;
      }
      newSelected.add(category);
    }
    tapFeedback('selection');
    setSelectedCategories(newSelected);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <Pressable
          onPress={onBack}
          hitSlop={sz(12)}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
        >
          <AntDesign name="arrow-left" size={sz(24)} color={colors.text} />
        </Pressable>

        {/* Text Content */}
        <View style={styles.textContainer}>
          <Text style={styles.title}>Choose your{'\n'}category</Text>
          <Text style={styles.subtitle}>
            Choose the content categories that best describe your work.{'\n'}You can select 10 maximum
          </Text>
        </View>

        {/* Grid Options */}
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.gridContainer}>
            {CATEGORIES.map((category) => {
              const isSelected = selectedCategories.has(category);
              return (
                <Pressable
                  key={category}
                  style={({ pressed }) => [styles.pillItem, isSelected && styles.pillItemSelected, pressed && styles.chipPressed]}
                  onPress={() => toggleCategory(category)}
                >
                  {isSelected && (
                    <AntDesign name="check" size={sz(12)} color={colors.primary} style={styles.pillIcon} />
                  )}
                  <Text 
                    style={[styles.pillItemText, isSelected && styles.pillItemTextSelected]}
                  >
                    {category}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.nextButton,
              selectedCategories.size === 0 && styles.nextButtonDisabled,
              pressed && styles.pressed,
            ]}
            disabled={selectedCategories.size === 0}
            onPress={() => {
              tapFeedback();
              onNext?.(Array.from(selectedCategories));
            }}
          >
            <Text style={styles.nextButtonText}>Next</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    paddingTop: sz(16),
    paddingBottom: sz(32),
  },
  backButton: {
    marginBottom: sz(24),
    paddingHorizontal: sz(20),
  },
  textContainer: {
    marginBottom: sz(32),
    paddingHorizontal: sz(20),
  },
  title: {
    color: colors.text,
    fontSize: sz(40),
    fontWeight: '700',
    lineHeight: sz(44),
    marginBottom: sz(12),
  },
  subtitle: {
    color: '#8A8A8A',
    fontSize: sz(14),
    lineHeight: sz(20),
    fontWeight: '400',
    paddingRight: sz(10),
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: sz(20),
    paddingBottom: sz(40),
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: sz(12),
  },
  pillItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: sz(12),
    paddingHorizontal: sz(16),
    borderRadius: sz(999),
    borderWidth: 1.5,
    borderColor: '#262626',
    backgroundColor: '#0A0A0A',
  },
  pillItemSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(255, 90, 31, 0.05)',
  },
  pillIcon: {
    marginRight: sz(6),
  },
  pillItemText: {
    color: '#A0A0A0',
    fontSize: sz(14),
    fontWeight: '600',
  },
  pillItemTextSelected: {
    color: colors.primary,
  },
  footer: {
    paddingHorizontal: sz(20),
    paddingTop: sz(16),
    backgroundColor: colors.background,
  },
  nextButton: {
    backgroundColor: colors.primary,
    height: sz(56),
    borderRadius: sz(999),
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  nextButtonDisabled: {
    opacity: 0.5,
  },
  nextButtonText: {
    color: colors.text,
    fontSize: sz(18),
    fontWeight: '700',
  },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  backPressed: { opacity: 0.6 },
  chipPressed: { transform: [{ scale: 0.96 }], opacity: 0.85 },
});
