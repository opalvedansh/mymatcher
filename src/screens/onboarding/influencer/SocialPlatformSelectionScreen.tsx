import { useState } from 'react';
import { AntDesign, FontAwesome6 } from '@expo/vector-icons';
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

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', icon: 'instagram' },
  { id: 'facebook', label: 'Facebook', icon: 'facebook' },
  { id: 'x', label: 'X', icon: 'x-twitter' },
  { id: 'youtube', label: 'Youtube', icon: 'youtube' },
  { id: 'linkedin', label: 'LinkedIn', icon: 'linkedin' },
  { id: 'snapchat', label: 'Snapchat', icon: 'snapchat' },
  { id: 'threads', label: 'Thread', icon: 'threads' },
  { id: 'pinterest', label: 'Pinterest', icon: 'pinterest' },
  { id: 'spotify', label: 'Spotify', icon: 'spotify' },
  { id: 'twitch', label: 'Twitch', icon: 'twitch' },
  { id: 'reddit', label: 'Reddit', icon: 'reddit-alien' },
  { id: 'discord', label: 'Discord', icon: 'discord' },
  { id: 'behance', label: 'Behance', icon: 'behance' },
  { id: 'dribbble', label: 'Dribble', icon: 'dribbble' },
] as const;

export function SocialPlatformSelectionScreen({
  initialPlatforms,
  onBack,
  onNext,
}: {
  initialPlatforms?: string[];
  onBack?: () => void;
  onNext?: (platforms: string[]) => void;
}) {
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(
    () => new Set((initialPlatforms ?? []).filter((id) => PLATFORMS.some((p) => p.id === id)).slice(0, 3)),
  );

  const togglePlatform = (id: string) => {
    const newSelected = new Set(selectedPlatforms);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      if (newSelected.size >= 3) {
        // Enforce maximum 3 selections
        return;
      }
      newSelected.add(id);
    }
    tapFeedback('selection');
    setSelectedPlatforms(newSelected);
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
          <AntDesign name="arrow-left" size={sz(20)} color={colors.text} />
        </Pressable>

        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Text Content */}
          <View style={styles.textContainer}>
            <Text style={styles.title}>Where do you{'\n'}create content?</Text>
            <Text style={styles.subtitle}>
              Select all the platforms where you're active it help brands discover you by selecting your active social channels
            </Text>
          </View>

          {/* Grid Options */}
          <View style={styles.gridContainer}>
            {PLATFORMS.map((platform) => {
              const isSelected = selectedPlatforms.has(platform.id);
              return (
                <Pressable
                  key={platform.id}
                  style={({ pressed }) => [styles.gridItem, isSelected && styles.gridItemSelected, pressed && styles.chipPressed]}
                  onPress={() => togglePlatform(platform.id)}
                >
                  <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                    {isSelected && <AntDesign name="check" size={sz(10)} color="#000" />}
                  </View>
                  <FontAwesome6
                    name={platform.icon}
                    size={sz(22)}
                    color={isSelected ? colors.primary : colors.text}
                    style={styles.icon}
                  />
                  <Text style={[styles.gridItemText, isSelected && styles.gridItemTextSelected]}>
                    {platform.label}
                  </Text>
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
              selectedPlatforms.size === 0 && styles.nextButtonDisabled,
              pressed && styles.pressed,
            ]}
            disabled={selectedPlatforms.size === 0}
            onPress={() => {
              tapFeedback();
              onNext?.(Array.from(selectedPlatforms));
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
    fontSize: sz(14),
    lineHeight: sz(20),
    fontWeight: '400',
    paddingRight: sz(10),
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  gridItem: {
    width: '23%', // 4 columns
    aspectRatio: 1,
    borderRadius: sz(16),
    borderWidth: 1.5,
    borderColor: '#262626',
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: sz(12),
    position: 'relative',
  },
  gridItemSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(255, 90, 31, 0.05)',
  },
  checkbox: {
    position: 'absolute',
    top: sz(8),
    right: sz(8),
    width: sz(18),
    height: sz(18),
    borderRadius: sz(9),
    borderWidth: 1.5,
    borderColor: '#444444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  icon: {
    marginBottom: sz(6),
    marginTop: sz(8),
  },
  gridItemText: {
    color: '#A0A0A0',
    fontSize: sz(10),
    fontWeight: '600',
  },
  gridItemTextSelected: {
    color: colors.primary,
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
  chipPressed: { transform: [{ scale: 0.96 }], opacity: 0.85 },
});
