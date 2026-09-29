import { useState } from 'react';
import { AntDesign } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme/colors';
import { sz } from '@/theme/scale';
import { tapFeedback } from '@/utils/optionalModules';

const CATEGORIES = [
  { id: 'retail', name: 'Retail & Consumer' },
  { id: 'food', name: 'Food & Beverage' },
  { id: 'tech', name: 'Technology' },
  { id: 'auto', name: 'Automotive' },
  { id: 'health', name: 'Health & Wellness' },
  { id: 'edu', name: 'Education' },
  { id: 'finance', name: 'Finance' },
  { id: 'travel', name: 'Travel' },
  { id: 'entertainment', name: 'Entertainment' },
  { id: 'business', name: 'Business' },
  { id: 'lifestyle', name: 'Lifestyle' },
  { id: 'real_estate', name: 'Real Estate' },
  { id: 'other', name: 'Other' },
];

export function BrandCategorySelectionScreen({
  initialCategories,
  onBack,
  onNext,
}: {
  initialCategories?: string[];
  onBack?: () => void;
  onNext?: (categories: string[]) => void | Promise<void>;
}) {
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    () => new Set((initialCategories ?? []).filter((id) => CATEGORIES.some((c) => c.id === id)).slice(0, 6)),
  );
  // This is the last step: finishing uploads images and creates the profile,
  // which takes a few seconds; show it's working and block a second tap.
  const [submitting, setSubmitting] = useState(false);

  const handleFinish = async () => {
    if (submitting) return;
    tapFeedback();
    setSubmitting(true);
    try {
      await onNext?.(Array.from(selectedCategories));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleCategory = (id: string) => {
    const newSelected = new Set(selectedCategories);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      if (newSelected.size >= 6) {
        return; // Max 6 categories
      }
      newSelected.add(id);
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

        <ScrollView 
          style={styles.scrollView} 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Text Content */}
          <View style={styles.textContainer}>
            <Text style={styles.title}>Choose your{'\n'}category</Text>
            <Text style={styles.subtitle}>
              Choose the content categories that best describe your brand.
              You can select 6 maximum
            </Text>
          </View>

          {/* List Options */}
          <View style={styles.listContainer}>
            {CATEGORIES.map((cat) => {
              const isSelected = selectedCategories.has(cat.id);
              return (
                <Pressable
                  key={cat.id}
                  style={({ pressed }) => [
                    styles.categoryCard,
                    isSelected && styles.categoryCardSelected,
                    pressed && styles.cardPressed,
                  ]}
                  onPress={() => toggleCategory(cat.id)}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      isSelected && styles.categoryTextSelected,
                    ]}
                  >
                    {cat.name}
                  </Text>
                  <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                    {isSelected && <AntDesign name="check" size={sz(14)} color="#000000" />}
                  </View>
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
            disabled={selectedCategories.size === 0 || submitting}
            accessibilityState={{ busy: submitting, disabled: selectedCategories.size === 0 || submitting }}
            onPress={handleFinish}
          >
            {submitting ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text style={styles.nextButtonText}>Next</Text>
            )}
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: sz(20),
    paddingBottom: sz(40),
  },
  textContainer: {
    marginBottom: sz(32),
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
    fontSize: sz(13),
    lineHeight: sz(18),
    fontWeight: '400',
    paddingRight: sz(20),
  },
  listContainer: {
    gap: sz(16),
  },
  categoryCard: {
    height: sz(64),
    backgroundColor: '#000000',
    borderRadius: sz(12),
    borderWidth: 1.5,
    borderColor: '#262626',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sz(24),
  },
  categoryCardSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(255, 102, 0, 0.08)',
  },
  categoryText: {
    color: colors.text,
    fontSize: sz(16),
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  categoryTextSelected: {
    color: colors.primary,
    textAlign: 'left',
  },
  checkbox: {
    width: sz(24),
    height: sz(24),
    borderRadius: sz(12),
    borderWidth: 2,
    borderColor: '#444444',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
  },
  checkboxSelected: {
    opacity: 1,
    backgroundColor: colors.primary,
    borderColor: colors.primary,
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
  cardPressed: { transform: [{ scale: 0.99 }], opacity: 0.85 },
});
