import { useState, useEffect } from 'react';
import { AntDesign, Feather } from '@expo/vector-icons';
import {
  Keyboard,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
  ActivityIndicator,
} from 'react-native';

import api from '@/api/client';
import { colors } from '@/theme/colors';

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
  onBack,
  onNext,
}: {
  role: 'Brand' | 'Influencer';
  onBack?: () => void;
  onNext?: (name: string, instagramId?: string) => void;
}) {
  const [name, setName] = useState('');
  const [instagramId, setInstagramId] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSelected, setHasSelected] = useState(false);

  useEffect(() => {
    if (hasSelected || !instagramId || instagramId.length < 3) {
      setSearchResults([]);
      return;
    }
    
    setIsSearching(true);
    const timeout = setTimeout(async () => {
      const results = await fetchInstagramUsers(instagramId);
      setSearchResults(results);
      setIsSearching(false);
    }, 1500);

    return () => clearTimeout(timeout);
  }, [instagramId, hasSelected]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.container}>
        {/* Header */}
        <Pressable onPress={onBack} style={styles.backButton}>
          <AntDesign name="arrow-left" size={24} color={colors.text} />
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
            onSubmitEditing={() => {
              if (name.trim() !== '') {
                onNext?.(name, instagramId);
              }
            }}
          />
        </View>

        {role === 'Influencer' && (
          <View style={{ marginTop: 24, zIndex: 100 }}>
            <Text style={[styles.subtitle, { paddingRight: 0, marginBottom: 12 }]}>
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
                <View style={{ position: 'absolute', right: 20, top: 0, bottom: 0, justifyContent: 'center' }}>
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
                    style={styles.dropdownItem}
                    onPress={() => {
                      setInstagramId(item);
                      setHasSelected(true);
                      setSearchResults([]);
                    }}
                  >
                    <Feather name="instagram" size={16} color="#8A8A8A" />
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
            style={[
              styles.nextButton,
              name.trim() === '' && styles.nextButtonDisabled,
            ]}
            disabled={name.trim() === ''}
            onPress={() => {
              if (name.trim() !== '') {
                Keyboard.dismiss();
                onNext?.(name, instagramId);
              }
            }}
          >
            <Text style={styles.nextButtonText}>Next</Text>
          </Pressable>
        </View>
        </View>
      </TouchableWithoutFeedback>
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
  igInputWrapper: {
    width: '100%',
    height: 86,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262626',
    backgroundColor: '#000000',
    position: 'relative',
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
  dropdownContainer: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#262626',
    marginTop: 8,
    zIndex: 100,
    elevation: 10,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#262626',
    gap: 12,
  },
  dropdownItemText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '500',
  },
});
