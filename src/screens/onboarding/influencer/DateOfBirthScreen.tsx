import { useState } from 'react';
import { AntDesign } from '@expo/vector-icons';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme/colors';
import { DismissKeyboard } from '@/components/DismissKeyboard';
import { sz } from '@/theme/scale';
import { checkDob, formatDob } from '@/utils/dob';
import { tapFeedback } from '@/utils/optionalModules';

export function DateOfBirthScreen({
  initialDob,
  onBack,
  onNext,
}: {
  initialDob?: string;
  onBack?: () => void;
  onNext?: (dob: string) => void;
}) {
  // Drafts saved before auto-formatting may hold bare digits like 20112004.
  const [dob, setDob] = useState(() => formatDob(initialDob ?? ''));
  const check = checkDob(dob);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Lifts the Next button above the keyboard on iOS. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <DismissKeyboard>
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
          <Text style={styles.title}>What's your{'\n'}Date of Birth</Text>
          <Text style={styles.subtitle}>
            This is what is going to appear on your profile
          </Text>
        </View>

        {/* Input Field */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="DD/MM/YYYY"
            placeholderTextColor="#555555"
            value={dob}
            onChangeText={(text) => setDob((prev) => formatDob(text, prev))}
            selectionColor={colors.primary}
            keyboardType="number-pad"
            maxLength={10}
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
          />
        </View>
        {!check.ok && check.error && <Text style={styles.error}>{check.error}</Text>}

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.nextButton,
              !check.ok && styles.nextButtonDisabled,
              pressed && styles.pressed,
            ]}
            disabled={!check.ok}
            onPress={() => { tapFeedback(); Keyboard.dismiss(); onNext?.(dob); }}
          >
            <Text style={styles.nextButtonText}>Next</Text>
          </Pressable>
        </View>
      </View>
      </DismissKeyboard>
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
    paddingHorizontal: sz(20),
    paddingTop: sz(16),
    paddingBottom: sz(32),
  },
  backButton: {
    marginBottom: sz(24),
  },
  textContainer: {
    marginBottom: sz(40),
  },
  title: {
    color: colors.text,
    fontSize: sz(40),
    fontWeight: '700',
    lineHeight: sz(44),
    marginBottom: sz(8),
  },
  subtitle: {
    color: '#8A8A8A',
    fontSize: sz(13),
    lineHeight: sz(18),
    fontWeight: '400',
    paddingRight: sz(20),
  },
  inputContainer: {
    width: '100%',
    height: sz(86),
    borderRadius: sz(12),
    borderWidth: 1,
    borderColor: '#262626',
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: sz(14),
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: sz(16),
  },
  error: {
    color: '#FF6B6B',
    fontSize: sz(13),
    lineHeight: sz(18),
    marginTop: sz(10),
    textAlign: 'center',
  },
  footer: {
    flex: 1,
    justifyContent: 'flex-end',
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
});
