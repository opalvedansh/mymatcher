import { useState } from 'react';
import { AntDesign } from '@expo/vector-icons';
import {
  Keyboard,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors } from '@/theme/colors';
import { DismissKeyboard } from '@/components/DismissKeyboard';
import { sz } from '@/theme/scale';

export function BioInputScreen({
  onBack,
  onNext,
}: {
  onBack?: () => void;
  onNext?: (bio: string) => void;
}) {
  const [bio, setBio] = useState('');

  const charCount = bio.length;
  const isOverLimit = charCount > 250;
  const isValid = charCount > 0 && !isOverLimit;

  return (
    <SafeAreaView style={styles.safeArea}>
      <DismissKeyboard>
        <View style={styles.container}>
        {/* Header */}
        <Pressable onPress={onBack} style={styles.backButton}>
          <AntDesign name="arrow-left" size={sz(24)} color={colors.text} />
        </Pressable>

        {/* Text Content */}
        <View style={styles.textContainer}>
          <Text style={styles.title}>Write about{'\n'}yourself</Text>
          <Text style={styles.subtitle}>
            A small para about yourself that describes you so that brand can know more about you
          </Text>
        </View>

        {/* Text Input */}
        <View style={styles.inputContainer}>
          <TextInput
            style={[styles.input, isOverLimit && styles.inputError]}
            placeholder="Enter"
            placeholderTextColor="#666666"
            value={bio}
            onChangeText={setBio}
            multiline
            textAlignVertical="top"
          />
          <Text style={[styles.wordCount, isOverLimit && styles.wordCountError]}>
            {charCount}/250 characters
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable
            style={[
              styles.nextButton,
              !isValid && styles.nextButtonDisabled,
            ]}
            disabled={!isValid}
            onPress={() => { Keyboard.dismiss(); onNext?.(bio.trim()); }}
          >
            <Text style={styles.nextButtonText}>Next</Text>
          </Pressable>
        </View>
      </View>
      </DismissKeyboard>
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
  inputContainer: {
    width: '100%',
  },
  input: {
    width: '100%',
    height: sz(86),
    backgroundColor: '#000000',
    borderRadius: sz(12),
    borderWidth: 1,
    borderColor: '#262626',
    color: colors.text,
    fontSize: sz(14),
    paddingHorizontal: sz(16),
    paddingTop: sz(16),
    paddingBottom: sz(16),
    textAlign: 'center', 
  },
  inputError: {
    borderColor: '#FF4444',
  },
  wordCount: {
    color: '#666666',
    fontSize: sz(12),
    textAlign: 'right',
    marginTop: sz(8),
  },
  wordCountError: {
    color: '#FF4444',
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
});
