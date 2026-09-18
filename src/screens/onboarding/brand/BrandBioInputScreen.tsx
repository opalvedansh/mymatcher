import { useState } from 'react';
import { AntDesign, Ionicons } from '@expo/vector-icons';
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import { colors } from '@/theme/colors';
import { DismissKeyboard } from '@/components/DismissKeyboard';

const ACCENT = '#FF6B2B';
const DANGER = '#FF6B6B';
const MAX_CHARS = 250;
const NEAR_LIMIT = MAX_CHARS - 40;

// The card draws its own focus border, so drop the browser's outline.
const webNoOutline = Platform.select({ web: { outlineStyle: 'none' } as any, default: undefined });

export function BrandBioInputScreen({
  onBack,
  onNext,
}: {
  onBack?: () => void;
  onNext?: (bio: string) => void;
}) {
  const [bio, setBio] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const charCount = bio.trim().length;
  const isOverLimit = charCount > MAX_CHARS;
  const isValid = charCount > 0 && !isOverLimit;
  const counterColor = isOverLimit ? DANGER : charCount >= NEAR_LIMIT ? '#FFB27A' : '#8A8A8A';

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <DismissKeyboard>
          <View style={styles.container}>
            <View style={styles.header}>
              <Pressable
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel="Back"
                style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
              >
                <AntDesign name="arrow-left" size={22} color={colors.text} />
              </Pressable>
              <View style={styles.progressPill}>
                <Text style={styles.progressText}>Step 2 of 4</Text>
              </View>
            </View>

            <View style={styles.textContainer}>
              <Text style={styles.title} accessibilityRole="header">
                Write about{'\n'}
                <Text style={styles.titleHighlight}>your brand</Text>.
              </Text>
              <Text style={styles.subtitle}>
                Creators read this first. Say what you make, who it is for, and the kind of work you want.
              </Text>
            </View>

            <View style={[styles.inputCard, isFocused && styles.inputCardFocused, isOverLimit && styles.inputCardError]}>
              <TextInput
                style={[styles.input, webNoOutline]}
                placeholder="We make small-batch skincare for people who read the label..."
                placeholderTextColor="rgba(255,255,255,0.3)"
                multiline
                textAlignVertical="top"
                value={bio}
                onChangeText={setBio}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                accessibilityLabel="Brand bio"
                autoFocus
              />

              <View style={styles.inputFooter}>
                {isOverLimit ? (
                  <View style={styles.limitRow}>
                    <Ionicons name="alert-circle" size={15} color={DANGER} />
                    <Text style={styles.limitText}>Trim it to {MAX_CHARS} characters to continue.</Text>
                  </View>
                ) : (
                  <View />
                )}
                <Text style={[styles.counter, { color: counterColor }]}>
                  {charCount}/{MAX_CHARS}
                </Text>
              </View>
            </View>

            <View style={{ flex: 1 }} />

            <Pressable
              style={({ pressed }) => [styles.nextButton, !isValid && styles.nextButtonDisabled, pressed && styles.pressed]}
              disabled={!isValid}
              accessibilityRole="button"
              accessibilityState={{ disabled: !isValid }}
              onPress={() => onNext?.(bio.trim())}
            >
              <Text style={[styles.nextButtonText, !isValid && styles.nextButtonTextDisabled]}>Continue</Text>
            </Pressable>
          </View>
        </DismissKeyboard>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0A0A0A' },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 40,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#161616',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  progressPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#161616',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  progressText: { color: '#BDBDBD', fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  textContainer: { marginBottom: 28 },
  title: {
    color: '#FFF',
    fontSize: 40,
    fontWeight: '700',
    lineHeight: 46,
    letterSpacing: -1.2,
    marginBottom: 14,
  },
  titleHighlight: { color: ACCENT },
  subtitle: {
    color: '#9A9A9A',
    fontSize: 15,
    lineHeight: 23,
    paddingRight: 8,
  },
  inputCard: {
    height: 240,
    backgroundColor: '#111111',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
  },
  inputCardFocused: { borderColor: ACCENT, backgroundColor: '#151515' },
  inputCardError: { borderColor: DANGER },
  input: {
    flex: 1,
    color: '#FFF',
    fontSize: 16,
    lineHeight: 25,
    padding: 0,
  },
  inputFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  limitRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  limitText: { color: DANGER, fontSize: 12, flexShrink: 1 },
  counter: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  nextButton: {
    backgroundColor: ACCENT,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    boxShadow: '0px 8px 20px rgba(0,0,0,0.45)',
    elevation: 6,
  },
  nextButtonDisabled: {
    backgroundColor: '#1E1E1E',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    boxShadow: '0px 0px 0px rgba(0,0,0,0)',
    elevation: 0,
  },
  nextButtonText: { color: '#FFF', fontSize: 17, fontWeight: '700', letterSpacing: 0.2 },
  nextButtonTextDisabled: { color: '#6F6F6F' },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
});
