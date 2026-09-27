import { useState } from 'react';
import { AntDesign } from '@expo/vector-icons';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '@/theme/colors';
import { sz } from '@/theme/scale';

const PACKAGES = [
  { id: 'story', label: 'Story', description: 'A single 15s Instagram/Snapchat story.' },
  { id: 'reel', label: 'Reel', description: 'A high-quality short form video up to 60s.' },
  { id: 'brand_collab', label: 'Brand collaboration', description: 'Dedicated post or series on your feed.' },
  { id: 'ugc', label: 'UGC', description: 'Raw content created for the brand to use.' },
];

export function PricePackagesScreen({
  onBack,
  onStart,
}: {
  onBack?: () => void;
  onStart?: (selectedPackages: string[]) => void;
}) {
  const [selectedPackages, setSelectedPackages] = useState<Set<string>>(new Set());

  const togglePackage = (id: string) => {
    const newSelected = new Set(selectedPackages);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedPackages(newSelected);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <Pressable onPress={onBack} style={styles.backButton}>
          <AntDesign name="arrow-left" size={sz(20)} color={colors.text} />
        </Pressable>

        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Text Content */}
          <View style={styles.textContainer}>
            <Text style={styles.title}>Enter your{'\n'}price{'\n'}packages</Text>
            <Text style={styles.subtitle}>
              Write about your charges according to the deliverables.
            </Text>
          </View>

          {/* Packages List */}
          <View style={styles.packagesContainer}>
            {PACKAGES.map((pkg) => {
              const isSelected = selectedPackages.has(pkg.id);
              return (
                <Pressable
                  key={pkg.id}
                  style={[
                    styles.packageCard,
                    isSelected && styles.packageCardSelected,
                  ]}
                  onPress={() => togglePackage(pkg.id)}
                >
                  <View style={styles.packageCardContent}>
                    <Text style={[styles.packageText, isSelected && styles.packageTextSelected]}>
                      {pkg.label}
                    </Text>
                    {/* Optional: Add a subtle description for more professional feel */}
                    <Text style={[styles.packageDescription, isSelected && styles.packageDescriptionSelected]}>
                      {pkg.description}
                    </Text>
                  </View>
                  <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                    {isSelected && <AntDesign name="check" size={sz(14)} color="#000000" />}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable
            style={[
              styles.startButton,
              selectedPackages.size === 0 && styles.startButtonDisabled,
            ]}
            disabled={selectedPackages.size === 0}
            onPress={() => onStart?.(Array.from(selectedPackages))}
          >
            <Text style={styles.startButtonText}>Start</Text>
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
  packagesContainer: {
    gap: sz(16),
  },
  packageCard: {
    width: '100%',
    minHeight: sz(86),
    paddingVertical: sz(16),
    paddingHorizontal: sz(20),
    borderRadius: sz(16),
    borderWidth: 1.5,
    borderColor: '#262626',
    backgroundColor: '#0A0A0A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  packageCardSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(255, 90, 31, 0.05)',
  },
  packageCardContent: {
    flex: 1,
    paddingRight: sz(16),
  },
  packageText: {
    color: '#E0E0E0',
    fontSize: sz(16),
    fontWeight: '600',
    marginBottom: sz(4),
  },
  packageTextSelected: {
    color: colors.primary,
  },
  packageDescription: {
    color: '#666666',
    fontSize: sz(12),
    lineHeight: sz(16),
  },
  packageDescriptionSelected: {
    color: '#A0A0A0',
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
    backgroundColor: colors.background, // ensures it covers content if it scrolls under
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
});
