import { useState, useEffect } from 'react';
import { AntDesign, Feather } from '@expo/vector-icons';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import api from '@/api/client';
import { colors } from '@/theme/colors';
import { DismissKeyboard } from '@/components/DismissKeyboard';
import { sz } from '@/theme/scale';
import { tapFeedback } from '@/utils/optionalModules';

const fetchInstagramUsers = async (query: string): Promise<string[]> => {
  if (!query || query.length < 3) return [];
  const q = encodeURIComponent(query.replace('@', '').toLowerCase().trim());

  try {
    // Goes through the API client so the request carries the user's token.
    return await api.get<string[]>(`/api/profiles/search-instagram?q=${q}`);
  } catch (error) {
    console.warn('Failed to fetch Instagram suggestions:', error);
    return [];
  }
};

export function NameInputScreen({
  role,
  initialName,
  initialInstagramId,
  onBack,
  onNext,
}: {
  role: 'Brand' | 'Influencer';
  initialName?: string;
  initialInstagramId?: string;
  onBack?: () => void;
  onNext?: (name: string, instagramId?: string) => void;
}) {
  const [name, setName] = useState(initialName ?? '');
  const [instagramId, setInstagramId] = useState(initialInstagramId ?? '');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // A saved handle was picked last time; don't reopen suggestions for it.
  const [hasSelected, setHasSelected] = useState(!!initialInstagramId);

  useEffect(() => {
    if (hasSelected || !instagramId || instagramId.length < 3) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    // Replies can land out of order; only the latest query may write results.
    let cancelled = false;
    setIsSearching(true);
    const timeout = setTimeout(async () => {
      const results = await fetchInstagramUsers(instagramId);
      if (cancelled) return;
      setSearchResults(results);
      setIsSearching(false);
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      setIsSearching(false);
    };
  }, [instagramId, hasSelected]);

  const canContinue = name.trim() !== '';
  const submit = () => {
    if (!canContinue) return;
    tapFeedback();
    Keyboard.dismiss();
    onNext?.(name, instagramId);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
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
          <Text style={styles.title}>
            What's your{'\n'}
            {role === 'Brand' ? 'Brand Name' : 'Name'}
          </Text>
          <Text style={styles.subtitle}>
            This is what is going to appear on your profile
          </Text>
        </View>

        {/* Input Field */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Enter"
            placeholderTextColor="#555555"
            value={name}
            onChangeText={setName}
            selectionColor={colors.primary}
            autoCapitalize="words"
            autoCorrect={false}
            onSubmitEditing={submit}
          />
        </View>

        {role === 'Influencer' && (
          <View style={{ marginTop: sz(24), zIndex: 100 }}>
            <Text style={[styles.subtitle, { paddingRight: 0, marginBottom: sz(12) }]}>
              Connect Instagram (Optional)
            </Text>
            <View style={styles.igInputWrapper}>
              <TextInput
                style={styles.input}
                placeholder="@username"
                placeholderTextColor="#555555"
                value={instagramId}
                onChangeText={(text) => {
                  setInstagramId(text);
                  setHasSelected(false);
                }}
                selectionColor={colors.primary}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
              {isSearching && (
                <View style={{ position: 'absolute', right: sz(20), top: 0, bottom: 0, justifyContent: 'center' }}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              )}
            </View>

            {/* Dropdown Results — rendered OUTSIDE inputContainer so it's not clipped */}
            {searchResults.length > 0 && !hasSelected && (
              <View style={styles.dropdownContainer}>
                {searchResults.map((item, index) => (
                  <Pressable
                    key={index}
                    style={({ pressed }) => [styles.dropdownItem, pressed && styles.dropdownItemPressed]}
                    onPress={() => {
                      tapFeedback('selection');
                      setInstagramId(item);
                      setHasSelected(true);
                      setSearchResults([]);
                    }}
                  >
                    <Feather name="instagram" size={sz(16)} color="#8A8A8A" />
                    <Text style={styles.dropdownItemText}>{item}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.nextButton,
              !canContinue && styles.nextButtonDisabled,
              pressed && styles.pressed,
            ]}
            disabled={!canContinue}
            onPress={submit}
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
  igInputWrapper: {
    width: '100%',
    height: sz(86),
    borderRadius: sz(12),
    borderWidth: 1,
    borderColor: '#262626',
    backgroundColor: '#000000',
    position: 'relative',
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: sz(14),
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: sz(16),
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
  dropdownItemPressed: { backgroundColor: '#222222' },
  dropdownContainer: {
    backgroundColor: '#1A1A1A',
    borderRadius: sz(12),
    borderWidth: 1,
    borderColor: '#262626',
    marginTop: sz(8),
    zIndex: 100,
    elevation: 10,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: sz(14),
    paddingHorizontal: sz(16),
    borderBottomWidth: 1,
    borderBottomColor: '#262626',
    gap: sz(12),
  },
  dropdownItemText: {
    color: '#FFF',
    fontSize: sz(14),
    fontWeight: '500',
  },
});
