import { useRef, useState } from 'react';
import { AntDesign } from '@expo/vector-icons';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DismissKeyboard } from '@/components/DismissKeyboard';
import { PackagePriceEditor } from '@/components/PackagePriceEditor';
import { colors } from '@/theme/colors';
import { sz } from '@/theme/scale';
import { tapFeedback } from '@/utils/optionalModules';
import { completePackages, toPackageDrafts, type CreatorPackage } from '@/utils/packages';

export function PricePackagesScreen({
  initialPackages,
  onBack,
  onStart,
}: {
  initialPackages?: unknown;
  onBack?: () => void;
  onStart?: (packages: CreatorPackage[]) => void | Promise<void>;
}) {
  const [drafts, setDrafts] = useState(() => toPackageDrafts(initialPackages));
  // Missing prices are only pointed out once the creator tries to continue.
  const [showErrors, setShowErrors] = useState(false);
  // Finishing uploads photos and creates the profile, which takes a few
  // seconds; show it's working and block a second tap meanwhile.
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const packages = completePackages(drafts);

  const handleStart = async () => {
    if (submitting || drafts.length === 0) return;
    if (!packages) {
      setShowErrors(true);
      return;
    }
    tapFeedback();
    setSubmitting(true);
    try {
      await onStart?.(packages);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Keeps Start above the keyboard while a price is being typed. */}
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <Pressable
          onPress={onBack}
          hitSlop={sz(12)}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
        >
          <AntDesign name="arrow-left" size={sz(20)} color={colors.text} />
        </Pressable>

        <ScrollView
          ref={scrollRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <DismissKeyboard>
            <View style={styles.textContainer}>
              <Text style={styles.title}>Enter your{'\n'}price{'\n'}packages</Text>
              <Text style={styles.subtitle}>
                Pick what you offer and set your price for each. Brands see these on your profile.
              </Text>
            </View>
          </DismissKeyboard>

          <PackagePriceEditor
            drafts={drafts}
            onChange={setDrafts}
            showErrors={showErrors}
            scrollRef={scrollRef}
          />
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          {showErrors && !packages && drafts.length > 0 && (
            <Text style={styles.hint}>Add a price for each package you picked.</Text>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.startButton,
              (drafts.length === 0 || (showErrors && !packages)) && styles.startButtonDisabled,
              pressed && styles.pressed,
            ]}
            disabled={drafts.length === 0 || submitting}
            accessibilityState={{ busy: submitting, disabled: drafts.length === 0 || submitting }}
            onPress={handleStart}
          >
            {submitting ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text style={styles.startButtonText}>Start</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
    marginBottom: sz(32),
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
    marginBottom: sz(16),
  },
  subtitle: {
    color: '#8A8A8A',
    fontSize: sz(14),
    lineHeight: sz(20),
    fontWeight: '400',
    paddingRight: sz(20),
  },
  footer: {
    paddingHorizontal: sz(20),
    paddingTop: sz(12),
    backgroundColor: colors.background, // ensures it covers content if it scrolls under
  },
  hint: {
    color: '#FF6B6B',
    fontSize: sz(13),
    textAlign: 'center',
    marginBottom: sz(10),
  },
  startButton: {
    backgroundColor: colors.primary,
    height: sz(56),
    borderRadius: sz(999),
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  startButtonDisabled: {
    opacity: 0.5,
  },
  startButtonText: {
    color: colors.text,
    fontSize: sz(18),
    fontWeight: '700',
  },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  backPressed: { opacity: 0.6 },
});
