import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  Image,
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import api from '@/api/client';
import { uploadImage } from '@/api';

// ─── Aspect Ratio Options ────────────────────────────────────────────────────
const ASPECTS = [
  { label: '1:1', ratio: [1, 1] as [number, number] },
  { label: '4:5', ratio: [4, 5] as [number, number] },
  { label: '16:9', ratio: [16, 9] as [number, number] },
];

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function CreatePostScreen() {
  const router = useRouter();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [selectedAspect, setSelectedAspect] = useState(1); // Default 4:5
  const captionRef = useRef<TextInput>(null);
  const uploadProgress = useRef(new Animated.Value(0)).current;

  const pickImage = async (fromCamera = false) => {
    if (fromCamera) {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow camera access.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: ASPECTS[selectedAspect].ratio,
        quality: 0.85,
      });
      if (!result.canceled && result.assets.length > 0) setImageUri(result.assets[0].uri);
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow photo library access.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: ASPECTS[selectedAspect].ratio,
        quality: 0.85,
      });
      if (!result.canceled && result.assets.length > 0) setImageUri(result.assets[0].uri);
    }
  };

  const handlePost = async () => {
    if (!imageUri) {
      Alert.alert('No image', 'Please select a photo first.');
      return;
    }
    try {
      setIsUploading(true);

      // Animate progress bar
      Animated.timing(uploadProgress, {
        toValue: 1,
        duration: 2000,
        useNativeDriver: false,
      }).start();

      const publicUrl = await uploadImage(imageUri);
      await api.post('/api/posts', { image_url: publicUrl, caption: caption.trim() || null });

      router.back();
    } catch (err: any) {
      Alert.alert('Failed to post', err?.message || 'Something went wrong. Try again.');
      uploadProgress.setValue(0);
    } finally {
      setIsUploading(false);
    }
  };

  const [aspectRatio, numerator, denominator] = [
    ASPECTS[selectedAspect].ratio[0] / ASPECTS[selectedAspect].ratio[1],
    ASPECTS[selectedAspect].ratio[0],
    ASPECTS[selectedAspect].ratio[1],
  ];

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerIconBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color="#FFF" />
          </Pressable>

          <Text style={styles.headerTitle}>New Post</Text>

          <Pressable
            style={[styles.shareBtn, (!imageUri || isUploading) && styles.shareBtnDisabled]}
            onPress={() => { Keyboard.dismiss(); handlePost(); }}
            disabled={!imageUri || isUploading}
          >
            {isUploading ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="send" size={14} color="#FFF" />
                <Text style={styles.shareBtnText}>Share</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* Upload progress bar */}
        {isUploading && (
          <Animated.View style={[styles.progressBar, {
            width: uploadProgress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          }]} />
        )}

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* ── Image Area ─────────────────────────────────────────── */}
          <View style={styles.imageSection}>
            {/* Aspect ratio selector */}
            <View style={styles.aspectRow}>
              {ASPECTS.map((a, i) => (
                <Pressable
                  key={a.label}
                  style={[styles.aspectChip, selectedAspect === i && styles.aspectChipActive]}
                  onPress={() => setSelectedAspect(i)}
                >
                  <Text style={[styles.aspectChipText, selectedAspect === i && styles.aspectChipTextActive]}>
                    {a.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Image preview / picker */}
            {imageUri ? (
              <View style={[styles.previewContainer, { aspectRatio }]}>
                <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />

                {/* Dark overlay on bottom */}
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.55)']}
                  style={[StyleSheet.absoluteFill, { top: '50%' }]}
                  pointerEvents="none"
                />

                {/* Bottom action chips */}
                <View style={styles.previewActions}>
                  <TouchableOpacity style={styles.previewActionBtn} onPress={() => pickImage(false)}>
                    <Ionicons name="images-outline" size={18} color="#FFF" />
                    <Text style={styles.previewActionText}>Gallery</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.previewActionBtn} onPress={() => pickImage(true)}>
                    <Ionicons name="camera-outline" size={18} color="#FFF" />
                    <Text style={styles.previewActionText}>Camera</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              /* Empty picker */
              <View style={[styles.emptyPicker, { aspectRatio }]}>
                <LinearGradient
                  colors={['#161616', '#1E1E1E']}
                  style={StyleSheet.absoluteFill}
                />
                <View style={styles.emptyPickerInner}>
                  <View style={styles.uploadIconRing}>
                    <Ionicons name="add" size={32} color="#FF6B2B" />
                  </View>
                  <Text style={styles.emptyPickerTitle}>Add a photo</Text>
                  <Text style={styles.emptyPickerSub}>Tap to choose from your library</Text>

                  <View style={styles.emptyPickerBtns}>
                    <TouchableOpacity style={styles.emptyPickerBtn} onPress={() => pickImage(false)} activeOpacity={0.8}>
                      <Ionicons name="images-outline" size={20} color="#FFF" />
                      <Text style={styles.emptyPickerBtnText}>Gallery</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.emptyPickerBtn, styles.emptyPickerBtnOutline]} onPress={() => pickImage(true)} activeOpacity={0.8}>
                      <Ionicons name="camera-outline" size={20} color="#FF6B2B" />
                      <Text style={[styles.emptyPickerBtnText, { color: '#FF6B2B' }]}>Camera</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          </View>

          {/* ── Caption ─────────────────────────────────────────────── */}
          <View style={styles.captionCard}>
            <View style={styles.captionHeader}>
              <MaterialCommunityIcons name="text" size={16} color="#888" />
              <Text style={styles.captionLabel}>Caption</Text>
            </View>
            <TextInput
              ref={captionRef}
              style={styles.captionInput}
              placeholder="Write something about this post..."
              placeholderTextColor="#444"
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={500}
              textAlignVertical="top"
              returnKeyType="done"
              blurOnSubmit
            />
            <View style={styles.captionFooter}>
              <Text style={styles.charCount}>{caption.length}/500</Text>
            </View>
          </View>

          {/* ── Info banner ─────────────────────────────────────────── */}
          <View style={styles.infoBanner}>
            <Ionicons name="sparkles-outline" size={14} color="#FF6B2B" />
            <Text style={styles.infoText}>
              Posts appear in the discovery feed and on your profile for brands to find you
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.07)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  shareBtn: {
    backgroundColor: '#FF4500',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  shareBtnDisabled: {
    opacity: 0.35,
  },
  shareBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // Progress bar
  progressBar: {
    height: 2,
    backgroundColor: '#FF4500',
    position: 'absolute',
    top: 68,
    left: 0,
    zIndex: 10,
  },

  // Image section
  imageSection: {
    marginHorizontal: 16,
    marginTop: 12,
  },
  aspectRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  aspectChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  aspectChipActive: {
    backgroundColor: '#FF4500',
    borderColor: '#FF4500',
  },
  aspectChipText: {
    color: '#777',
    fontSize: 13,
    fontWeight: '600',
  },
  aspectChipTextActive: {
    color: '#FFF',
  },

  // Preview
  previewContainer: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#1A1A1A',
  },
  previewActions: {
    position: 'absolute',
    bottom: 14,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  previewActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  previewActionText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },

  // Empty picker
  emptyPicker: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderStyle: 'dashed',
  },
  emptyPickerInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    padding: 24,
  },
  uploadIconRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,107,43,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,43,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  emptyPickerTitle: {
    color: '#EEE',
    fontSize: 18,
    fontWeight: '700',
  },
  emptyPickerSub: {
    color: '#555',
    fontSize: 13,
    marginBottom: 16,
  },
  emptyPickerBtns: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  emptyPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#FF4500',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
  },
  emptyPickerBtnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'rgba(255,107,43,0.5)',
  },
  emptyPickerBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // Caption card
  captionCard: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#161616',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  captionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  captionLabel: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  captionInput: {
    color: '#FFF',
    fontSize: 15,
    minHeight: 90,
    lineHeight: 22,
  },
  captionFooter: {
    alignItems: 'flex-end',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  charCount: {
    color: '#444',
    fontSize: 12,
  },

  // Info banner
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 16,
  },
  infoText: {
    color: '#555',
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
});
