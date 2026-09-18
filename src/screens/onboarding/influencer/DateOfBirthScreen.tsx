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

export function DateOfBirthScreen({
  onBack,
  onNext,
}: {
  onBack?: () => void;
  onNext?: (dob: string) => void;
}) {
  const [dob, setDob] = useState('');

  return (
    <SafeAreaView style={styles.safeArea}>
      <DismissKeyboard>
        <View style={styles.container}>
        {/* Header */}
        <Pressable onPress={onBack} style={styles.backButton}>
          <AntDesign name="arrow-left" size={24} color={colors.text} />
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
            onChangeText={setDob}
            selectionColor={colors.primary}
            keyboardType="numeric"
            maxLength={10}
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
          />
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable
            style={[
              styles.nextButton,
              dob.trim() === '' && styles.nextButtonDisabled,
            ]}
            disabled={dob.trim() === ''}
            onPress={() => { Keyboard.dismiss(); onNext?.(dob); }}
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
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },
  backButton: {
    marginBottom: 24,
  },
  textContainer: {
    marginBottom: 40,
  },
  title: {
    color: colors.text,
    fontSize: 40,
    fontWeight: '700',
    lineHeight: 44,
    marginBottom: 8,
  },
  subtitle: {
    color: '#8A8A8A',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    paddingRight: 20,
  },
  inputContainer: {
    width: '100%',
    height: 86,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262626',
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  footer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  nextButton: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  nextButtonDisabled: {
    opacity: 0.5,
  },
  nextButtonText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
});
