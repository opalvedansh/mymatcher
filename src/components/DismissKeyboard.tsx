import React from 'react';
import { Keyboard, Platform, TouchableWithoutFeedback } from 'react-native';

/**
 * Tapping the background dismisses the keyboard on phones.
 *
 * On web the wrapper is skipped: react-native-web's TouchableWithoutFeedback
 * swallows the click before it reaches a TextInput, so fields never focus —
 * and a browser has no on-screen keyboard to dismiss anyway.
 */
export function DismissKeyboard({ children }: { children: React.ReactElement }) {
  if (Platform.OS === 'web') return children;
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      {children}
    </TouchableWithoutFeedback>
  );
}
