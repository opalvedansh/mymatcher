import { useState } from 'react';
import { AntDesign } from '@expo/vector-icons';
import {
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

type Gender = 'Male' | 'Female' | 'Other' | null;

const GENDERS = ['Male', 'Female', 'Other'] as const;

export function GenderSelectionScreen({
  initialGender,
  onBack,
  onNext,
}: {
  initialGender?: string;
  onBack?: () => void;
  onNext?: (gender: Gender) => void;
}) {
  const [selectedGender, setSelectedGender] = useState<Gender>(
    GENDERS.find((g) => g === initialGender) ?? null,
  );

  const selectGender = (gender: Gender) => {
    tapFeedback('selection');
    setSelectedGender(gender);
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

        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {/* Text Content */}
          <View style={styles.textContainer}>
            <Text style={styles.title}>What's your{'\n'}gender</Text>
            <Text style={styles.subtitle}>
              Select that describe you that will help us to show your profile to the right person
            </Text>
          </View>

          {/* Options */}
          <View style={styles.optionsContainer}>
            <Pressable
              style={({ pressed }) => [
                styles.optionCard,
                selectedGender === 'Male' && styles.optionCardSelected,
                pressed && styles.cardPressed,
              ]}
              onPress={() => selectGender('Male')}
            >
              <Text style={[styles.optionText, selectedGender === 'Male' && styles.optionTextSelected]}>Male</Text>
              <View style={[styles.checkbox, selectedGender === 'Male' && styles.checkboxSelected]}>
                {selectedGender === 'Male' && <AntDesign name="check" size={sz(14)} color="#000000" />}
              </View>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.optionCard,
                selectedGender === 'Female' && styles.optionCardSelected,
                pressed && styles.cardPressed,
              ]}
              onPress={() => selectGender('Female')}
            >
              <Text style={[styles.optionText, selectedGender === 'Female' && styles.optionTextSelected]}>Female</Text>
              <View style={[styles.checkbox, selectedGender === 'Female' && styles.checkboxSelected]}>
                {selectedGender === 'Female' && <AntDesign name="check" size={sz(14)} color="#000000" />}
              </View>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.optionCard,
                selectedGender === 'Other' && styles.optionCardSelected,
                pressed && styles.cardPressed,
              ]}
              onPress={() => selectGender('Other')}
            >
              <Text style={[styles.optionText, selectedGender === 'Other' && styles.optionTextSelected]}>Other</Text>
              <View style={[styles.checkbox, selectedGender === 'Other' && styles.checkboxSelected]}>
                {selectedGender === 'Other' && <AntDesign name="check" size={sz(14)} color="#000000" />}
              </View>
            </Pressable>
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.nextButton,
              !selectedGender && styles.nextButtonDisabled,
              pressed && styles.pressed,
            ]}
            disabled={!selectedGender}
            onPress={() => {
              tapFeedback();
              onNext?.(selectedGender);
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: sz(20),
    paddingBottom: sz(40),
  },
  textContainer: {
    marginBottom: sz(40),
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
    paddingRight: sz(20),
  },
  optionsContainer: {
    gap: sz(16),
  },
  optionCard: {
    width: '100%',
    minHeight: sz(86),
    paddingHorizontal: sz(24),
    borderRadius: sz(16),
    borderWidth: 1.5,
    borderColor: '#262626',
    backgroundColor: '#0A0A0A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(255, 90, 31, 0.05)',
  },
  optionText: {
    color: '#E0E0E0',
    fontSize: sz(16),
    fontWeight: '600',
  },
  optionTextSelected: {
    color: colors.primary,
  },
  checkbox: {
    width: sz(24),
    height: sz(24),
    borderRadius: sz(12),
    borderWidth: 1.5,
    borderColor: '#444444',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  checkboxSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
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
