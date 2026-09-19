import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import api from '@/api/client';
import { uploadImage } from '@/api';
import { showAlert } from '@/components/ActionSheet';

const ACCENT = '#FF6B2B';
const MAX_CAPTION = 500;

// The card draws its own focus border, so drop the browser's outline.
const webNoOutline = Platform.select({ web: { outlineStyle: 'none' } as any, default: undefined });

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
  const [captionFocused, setCaptionFocused] = useState(false);
  const [selectedAspect, setSelectedAspect] = useState(1); // Default 4:5

  const aspectRatio = ASPECTS[selectedAspect].ratio[0] / ASPECTS[selectedAspect].ratio[1];
  const canPost = !!imageUri && !isUploading;

  const pickImage = async (fromCamera = false) => {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      showAlert(
        fromCamera ? 'Camera access needed' : 'Photo access needed',
        `Allow ${fromCamera ? 'camera' : 'photo library'} access in your settings to add a photo.`,
      );
      return;
    }

    const options = {
      allowsEditing: true,
      aspect: ASPECTS[selectedAspect].ratio,
      quality: 0.85,
    };
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync({ ...options, mediaTypes: ImagePicker.MediaTypeOptions.Images });

    if (!result.canceled && result.assets.length > 0) setImageUri(result.assets[0].uri);
  };

  const handlePost = async () => {
    if (!imageUri || isUploading) return;
    try {
      setIsUploading(true);
      const publicUrl = await uploadImage(imageUri);
      await api.post('/api/posts', { image_url: publicUrl, caption: caption.trim() || null });
      router.back();
    } catch (err: any) {
      showAlert('Post not shared', err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
            disabled={isUploading}
          >
            <Ionicons name="arrow-back" size={22} color="#FFF" />
          </Pressable>

          <Text style={styles.headerTitle} accessibilityRole="header">New post</Text>

          <Pressable
            style={({ pressed }) => [styles.shareBtn, !canPost && styles.shareBtnDisabled, pressed && styles.pressed]}
            onPress={() => { Keyboard.dismiss(); handlePost(); }}
            disabled={!canPost}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canPost }}
          >
            {isUploading ? (
              <>
                <ActivityIndicator size="small" color="#FFF" />
                <Text style={styles.shareBtnText}>Posting</Text>
              </>
            ) : (
              <Text style={[styles.shareBtnText, !canPost && styles.shareBtnTextDisabled]}>Share</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.content}>
            {/* ── Image ──────────────────────────────────────────── */}
            {imageUri ? (
              <View style={[styles.previewContainer, { aspectRatio }]}>
                <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />

                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.6)']}
                  style={[StyleSheet.absoluteFill, { top: '55%' }]}
                  pointerEvents="none"
                />

                <Pressable
                  style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
                  onPress={() => setImageUri(null)}
                  disabled={isUploading}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  hitSlop={8}
                >
                  <Ionicons name="close" size={18} color="#FFF" />
                </Pressable>

                <View style={styles.previewActions}>
                  <Pressable
                    style={({ pressed }) => [styles.previewActionBtn, pressed && styles.pressed]}
                    onPress={() => pickImage(false)}
                    disabled={isUploading}
                    accessibilityRole="button"
                  >
                    <Ionicons name="images-outline" size={17} color="#FFF" />
                    <Text style={styles.previewActionText}>Replace photo</Text>
                  </Pressable>
                </View>

                {isUploading && (
                  <View style={styles.uploadingOverlay}>
                    <ActivityIndicator color="#FFF" />
                    <Text style={styles.uploadingText}>Posting your photo</Text>
                  </View>
                )}
              </View>
            ) : (
              <>
                {/* Shape is chosen before picking, because the crop happens in the picker. */}
                <View style={styles.aspectRow}>
                  {ASPECTS.map((a, i) => (
                    <Pressable
                      key={a.label}
                      style={({ pressed }) => [styles.aspectChip, selectedAspect === i && styles.aspectChipActive, pressed && styles.pressed]}
                      onPress={() => setSelectedAspect(i)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedAspect === i }}
                      accessibilityLabel={`Crop ${a.label}`}
                    >
                      <Text style={[styles.aspectChipText, selectedAspect === i && styles.aspectChipTextActive]}>
                        {a.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Pressable
                  style={({ pressed }) => [styles.emptyPicker, { aspectRatio }, pressed && styles.emptyPickerPressed]}
                  onPress={() => pickImage(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Add a photo from your library"
                >
                  <View style={styles.emptyPickerInner}>
                    <View style={styles.uploadIconRing}>
                      <Ionicons name="image-outline" size={28} color={ACCENT} />
                    </View>
                    <Text style={styles.emptyPickerTitle}>Add a photo</Text>
                    <Text style={styles.emptyPickerSub}>Tap anywhere to choose from your library</Text>

                    <View style={styles.emptyPickerBtns}>
                      <Pressable
                        style={({ pressed }) => [styles.emptyPickerBtn, pressed && styles.pressed]}
                        onPress={() => pickImage(false)}
                        accessibilityRole="button"
                      >
                        <Ionicons name="images-outline" size={18} color="#FFF" />
                        <Text style={styles.emptyPickerBtnText}>Gallery</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [styles.emptyPickerBtn, styles.emptyPickerBtnOutline, pressed && styles.pressed]}
                        onPress={() => pickImage(true)}
                        accessibilityRole="button"
                      >
                        <Ionicons name="camera-outline" size={18} color="#FFF" />
                        <Text style={styles.emptyPickerBtnText}>Camera</Text>
                      </Pressable>
                    </View>
                  </View>
                </Pressable>
              </>
            )}

            {/* ── Caption ────────────────────────────────────────── */}
            <View style={[styles.captionCard, captionFocused && styles.captionCardFocused]}>
              <Text style={styles.captionLabel}>Caption</Text>
              <TextInput
                style={[styles.captionInput, webNoOutline]}
                placeholder="Say what this is, and who it was for."
                placeholderTextColor="#8A8A8A"
                value={caption}
                onChangeText={setCaption}
                onFocus={() => setCaptionFocused(true)}
                onBlur={() => setCaptionFocused(false)}
                multiline
                maxLength={MAX_CAPTION}
                textAlignVertical="top"
                editable={!isUploading}
                accessibilityLabel="Caption"
              />
              <View style={styles.captionFooter}>
                <Text style={styles.charCount}>{caption.length}/{MAX_CAPTION}</Text>
              </View>
            </View>

            {/* ── Info ───────────────────────────────────────────── */}
            <View style={styles.infoBanner}>
              <Ionicons name="information-circle-outline" size={15} color="#8A8A8A" />
              <Text style={styles.infoText}>Your post appears in the feed and on your profile.</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  scrollContent: { paddingBottom: 40 },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 16 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { color: '#FFF', fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  shareBtn: {
    minWidth: 86,
    height: 40,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: ACCENT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareBtnDisabled: {
    backgroundColor: '#1A1A1A',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  shareBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  shareBtnTextDisabled: { color: '#6F6F6F' },

  // Image
  aspectRow: { flexDirection: 'row', gap: 8, marginTop: 16, marginBottom: 12 },
  aspectChip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#161616',
  },
  aspectChipActive: { backgroundColor: '#FFF', borderColor: '#FFF' },
  aspectChipText: { color: '#9A9A9A', fontSize: 13, fontWeight: '600' },
  aspectChipTextActive: { color: '#111' },

  previewContainer: {
    width: '100%',
    marginTop: 16,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#1A1A1A',
  },
  removeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewActions: { position: 'absolute', bottom: 14, left: 0, right: 0, alignItems: 'center' },
  previewActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  previewActionText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  uploadingOverlay: {
    position: 'absolute',
    top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  uploadingText: { color: '#FFF', fontSize: 14, fontWeight: '600' },

  // Empty picker
  emptyPicker: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderStyle: 'dashed',
    backgroundColor: '#131313',
  },
  emptyPickerPressed: { backgroundColor: '#171717', borderColor: 'rgba(255,107,43,0.5)' },
  emptyPickerInner: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  uploadIconRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,107,43,0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,107,43,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyPickerTitle: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  emptyPickerSub: { color: '#9A9A9A', fontSize: 13, marginTop: 6, marginBottom: 22, textAlign: 'center' },
  emptyPickerBtns: { flexDirection: 'row', gap: 10 },
  emptyPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: ACCENT,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 22,
  },
  emptyPickerBtnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  emptyPickerBtnText: { color: '#FFF', fontSize: 14, fontWeight: '600' },

  // Caption card
  captionCard: {
    marginTop: 16,
    backgroundColor: '#131313',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  captionCardFocused: { borderColor: ACCENT, backgroundColor: '#161616' },
  captionLabel: { color: '#E6E6E6', fontSize: 13, fontWeight: '600', marginBottom: 10 },
  captionInput: { color: '#FFF', fontSize: 15, minHeight: 90, lineHeight: 22, padding: 0 },
  captionFooter: {
    alignItems: 'flex-end',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  charCount: { color: '#8A8A8A', fontSize: 12, fontVariant: ['tabular-nums'] },

  // Info
  infoBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, paddingHorizontal: 4 },
  infoText: { color: '#8A8A8A', fontSize: 12, flex: 1, lineHeight: 17 },

  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
});
