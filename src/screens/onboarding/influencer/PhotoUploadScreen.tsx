import { AntDesign } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { isUsableImage } from '@/contexts/AuthContext';
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

export function PhotoUploadScreen({
  initialPhotos,
  onBack,
  onNext,
}: {
  initialPhotos?: string[];
  onBack?: () => void;
  onNext?: (photos: string[]) => void;
}) {
  const [photos, setPhotos] = useState<string[]>(() => (initialPhotos ?? []).filter(isUsableImage).slice(0, 6));

  const pickImage = async (index: number) => {
    // No permissions request is necessary for launching the image library
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 5],
      quality: 0.8,
    });

    if (!result.canceled) {
      const newPhotos = [...photos];
      newPhotos[index] = result.assets[0].uri;
      // Filter out empty spots if someone skipped a slot, though we just assign by index
      setPhotos(newPhotos);
    }
  };

  const removePhoto = (index: number) => {
    const newPhotos = [...photos];
    newPhotos.splice(index, 1);
    setPhotos(newPhotos);
  };

  const renderPhotoSlots = () => {
    const slots = [];
    for (let i = 0; i < 6; i++) {
      const uri = photos[i];
      slots.push(
        <Pressable 
          key={i} 
          style={({ pressed }) => [styles.photoSlot, pressed && styles.slotPressed]}
          onPress={() => pickImage(i)}
        >
          {uri ? (
            <>
              <Image source={{ uri }} style={styles.image} contentFit="cover" transition={150} />
              <Pressable 
                style={styles.removeButton}
                onPress={(e) => {
                  e.stopPropagation();
                  removePhoto(i);
                }}
              >
                <AntDesign name="close" size={sz(12)} color="#FFF" />
              </Pressable>
            </>
          ) : (
            <AntDesign name="plus" size={sz(24)} color="#444444" />
          )}
        </Pressable>
      );
    }
    return slots;
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
          <AntDesign name="arrow-left" size={sz(24)} color={colors.text} />
        </Pressable>

        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Text Content */}
          <View style={styles.textContainer}>
            <Text style={styles.title}>Upload your{'\n'}pictures</Text>
            <Text style={styles.subtitle}>
              Add high-quality photos to increase your chances of matching with brands.
            </Text>
          </View>

          {/* Photo Grid */}
          <View style={styles.gridContainer}>
            {renderPhotoSlots()}
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.nextButton,
              photos.length === 0 && styles.nextButtonDisabled,
              pressed && styles.pressed,
            ]}
            onPress={() => {
              const validPhotos = photos.filter(Boolean);
              if (validPhotos.length > 0) {
                tapFeedback();
                onNext?.(validPhotos);
              }
            }}
            disabled={photos.length === 0}
          >
            <Text style={[
              styles.nextButtonText,
              photos.length === 0 && styles.nextButtonTextDisabled
            ]}>Next</Text>
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
    paddingRight: sz(20),
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  photoSlot: {
    width: '31%', // 3 per row with a bit of space
    aspectRatio: 0.65, // Taller than wide
    backgroundColor: '#000000',
    borderRadius: sz(12),
    borderWidth: 1,
    borderColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: sz(16),
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  removeButton: {
    position: 'absolute',
    top: sz(8),
    right: sz(8),
    width: sz(24),
    height: sz(24),
    borderRadius: sz(12),
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: '#333333',
  },
  nextButtonText: {
    color: colors.text,
    fontSize: sz(18),
    fontWeight: '700',
  },
  nextButtonTextDisabled: {
    color: '#8A8A8A',
  },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  backPressed: { opacity: 0.6 },
  slotPressed: { opacity: 0.8 },
});
