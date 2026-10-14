import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { StoryEditor, type StoryDraft } from '@/features/story/StoryEditor';
import { CloseFriendsSheet } from '@/features/story/StorySheets';
import { showAlert } from '@/components/ActionSheet';
import { sz } from '@/theme/scale';

export default function StoryCameraScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [flash, setFlash] = useState<'on' | 'off' | 'auto'>('off');
  const [isCapturing, setIsCapturing] = useState(false);
  // undefined: camera; null: a text-only story; otherwise the photo being edited.
  const [draft, setDraft] = useState<StoryDraft | undefined>(undefined);
  const cameraRef = useRef<any>(null);
  const [mode, setMode] = useState<'picture' | 'video'>('picture');
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [closeFriendsOpen, setCloseFriendsOpen] = useState(false);

  // The recording timer.
  useEffect(() => {
    if (recordingSince === null) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - recordingSince) / 1000)), 250);
    return () => clearInterval(t);
  }, [recordingSince]);

  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  function toggleCameraFacing() {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  }

  function toggleFlash() {
    setFlash(current => (current === 'off' ? 'on' : 'off'));
  }

  const switchMode = async (next: 'picture' | 'video') => {
    if (recordingSince !== null) return;
    setMode(next);
    // A video records sound when the microphone is allowed, and silently if not.
    if (next === 'video' && !micPermission?.granted && micPermission?.canAskAgain !== false) {
      await requestMicPermission();
    }
  };

  const toggleRecording = async () => {
    const camera = cameraRef.current;
    if (!camera) return;
    if (recordingSince !== null) {
      camera.stopRecording();
      return;
    }
    const started = Date.now();
    setElapsed(0);
    setRecordingSince(started);
    try {
      const video = await camera.recordAsync({ maxDuration: MAX_VIDEO_SECONDS });
      const durationMs = Date.now() - started;
      // A tap-and-release records nothing worth posting.
      if (video?.uri && durationMs >= 500) {
        setDraft({ uri: video.uri, width: 720, height: 1280, fit: 'cover', kind: 'video', durationMs });
      }
    } catch (err) {
      console.error('Failed to record story', err);
      showAlert('Couldn\'t record', 'Something went wrong with the camera. Please try again.');
    } finally {
      setRecordingSince(null);
    }
  };

  const handleCapture = async () => {
    if (mode === 'video') {
      toggleRecording();
      return;
    }
    if (!cameraRef.current || isCapturing) return;
    try {
      setIsCapturing(true);
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      // A camera shot fills the story; it can be pinched smaller in the editor.
      if (photo?.uri) setDraft({ uri: photo.uri, width: photo.width, height: photo.height, fit: 'cover' });
    } catch (err) {
      console.error('Failed to capture story', err);
      showAlert('Couldn\'t take the photo', 'Something went wrong with the camera. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  };

  const handlePickImage = async () => {
    if (isCapturing) return;
    // No system crop: the whole photo goes into the editor, which shows all
    // of it over a blurred fill and lets the author zoom or move it.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.7,
      videoMaxDuration: MAX_VIDEO_SECONDS,
      // 720p keeps a minute of video to a reasonable upload.
      videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
    });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    if (asset.type === 'video') {
      if (asset.fileSize && asset.fileSize > MAX_VIDEO_BYTES) {
        showAlert('Video too large', `Story videos can be up to ${MAX_VIDEO_BYTES / 1024 / 1024} MB. Try a shorter clip.`);
        return;
      }
      // Longer videos play their first minute.
      const durationMs = Math.min(asset.duration ?? MAX_VIDEO_SECONDS * 1000, MAX_VIDEO_SECONDS * 1000);
      setDraft({ uri: asset.uri, width: asset.width, height: asset.height, fit: 'contain', kind: 'video', durationMs });
      return;
    }
    setDraft({ uri: asset.uri, width: asset.width, height: asset.height, fit: 'contain' });
  };

  if (draft !== undefined) {
    return (
      <StoryEditor
        draft={draft}
        onClose={() => setDraft(undefined)}
        onPosted={() => router.back()}
      />
    );
  }

  if (!permission) {
    return <View style={styles.container} />;
  }

  // Without the camera, the library and text stories still work.
  if (!permission.granted) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: 'white', textAlign: 'center', marginBottom: sz(20) }}>
          We need your permission to show the camera
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={{ color: 'white', fontWeight: '600' }}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ marginTop: sz(20) }} onPress={handlePickImage}>
          <Text style={{ color: 'white', fontSize: sz(16) }}>Choose from library</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ marginTop: sz(16) }} onPress={() => setDraft(null)}>
          <Text style={{ color: 'white', fontSize: sz(16) }}>Create a text story</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ marginTop: sz(16) }} onPress={() => router.back()}>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: sz(16) }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing={facing}
        flash={flash}
        ref={cameraRef}
        mode={mode}
        videoQuality="720p"
        mute={mode === 'video' && !micPermission?.granted}
      >
        <SafeAreaView style={styles.overlay}>
          {/* Top Bar */}
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
              <Ionicons name="close" size={sz(32)} color="white" />
            </TouchableOpacity>
            
            {recordingSince !== null ? (
              <View style={styles.recBadge}>
                <View style={styles.recDot} />
                <Text style={styles.recText}>
                  {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
                </Text>
              </View>
            ) : (
              <TouchableOpacity onPress={toggleFlash} style={styles.iconButton}>
                <Ionicons name={flash === 'on' ? "flash" : "flash-off"} size={sz(26)} color="white" />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() => setCloseFriendsOpen(true)}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel="Close Friends list"
            >
              <Ionicons name="star-outline" size={sz(26)} color="white" />
            </TouchableOpacity>
          </View>

          {/* Side Toolbar */}
          <View style={styles.sideToolbar}>
            <TouchableOpacity
              style={styles.toolButton}
              onPress={() => setDraft(null)}
              accessibilityRole="button"
              accessibilityLabel="Create a text story"
            >
              <Text style={{ color: 'white', fontSize: sz(20), fontWeight: 'bold' }}>Aa</Text>
            </TouchableOpacity>
          </View>

          {/* Photo / video */}
          {recordingSince === null && (
            <View style={styles.modeRow}>
              {(['picture', 'video'] as const).map((m) => (
                <TouchableOpacity key={m} onPress={() => switchMode(m)} accessibilityRole="button" accessibilityState={{ selected: mode === m }}>
                  <Text style={[styles.modeText, mode === m && styles.modeTextOn]}>{m === 'picture' ? 'PHOTO' : 'VIDEO'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Bottom Bar */}
          <View style={styles.bottomBar}>
            {/* Gallery picker */}
            <TouchableOpacity
              style={styles.galleryButton}
              onPress={handlePickImage}
              disabled={isCapturing}
              accessibilityRole="button"
              accessibilityLabel="Choose from library"
            >
              <Ionicons name="images-outline" size={sz(20)} color="white" />
            </TouchableOpacity>

            {/* Capture Button */}
            <View style={[styles.captureButtonContainer, mode === 'video' && styles.captureVideoRing]}>
              <TouchableOpacity
                style={[
                  styles.captureButtonInner,
                  mode === 'video' && styles.captureVideo,
                  recordingSince !== null && styles.captureRecording,
                ]}
                onPress={handleCapture}
                disabled={isCapturing}
                accessibilityRole="button"
                accessibilityLabel={mode === 'video' ? (recordingSince !== null ? 'Stop recording' : 'Record video') : 'Take photo'}
              >
                {isCapturing && <ActivityIndicator color="#000" size="large" />}
              </TouchableOpacity>
            </View>

            {/* Flip Camera */}
            <TouchableOpacity style={styles.flipButton} onPress={toggleCameraFacing}>
              <Ionicons name="camera-reverse-outline" size={sz(30)} color="white" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </CameraView>
      <CloseFriendsSheet visible={closeFriendsOpen} onClose={() => setCloseFriendsOpen(false)} onSaved={() => setCloseFriendsOpen(false)} />
    </View>
  );
}

const MAX_VIDEO_SECONDS = 60;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: sz(20),
    paddingTop: sz(20),
  },
  iconButton: {
    width: sz(44),
    height: sz(44),
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: sz(2),
  },
  sideToolbar: {
    position: 'absolute',
    left: sz(20),
    top: '30%',
    alignItems: 'center',
    gap: sz(24),
  },
  toolButton: {
    width: sz(40),
    height: sz(40),
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: sz(2),
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: sz(40),
    paddingBottom: sz(40),
  },
  galleryButton: {
    width: sz(40),
    height: sz(40),
    borderRadius: sz(8),
    borderWidth: 2,
    borderColor: 'white',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonContainer: {
    width: sz(80),
    height: sz(80),
    borderRadius: sz(40),
    borderWidth: 4,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonInner: {
    width: sz(66),
    height: sz(66),
    borderRadius: sz(33),
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flipButton: {
    width: sz(44),
    height: sz(44),
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: sz(22),
  },
  modeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: sz(24),
    marginBottom: sz(-20),
  },
  modeText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: sz(13),
    fontWeight: '700',
    letterSpacing: 1,
  },
  modeTextOn: {
    color: '#FFF',
  },
  captureVideoRing: {
    borderColor: 'rgba(255,255,255,0.9)',
  },
  captureVideo: {
    backgroundColor: '#ED4956',
  },
  captureRecording: {
    width: sz(34),
    height: sz(34),
    borderRadius: sz(8),
  },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(6),
    paddingHorizontal: sz(10),
    height: sz(30),
    borderRadius: sz(15),
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  recDot: {
    width: sz(8),
    height: sz(8),
    borderRadius: sz(4),
    backgroundColor: '#ED4956',
  },
  recText: {
    color: '#FFF',
    fontSize: sz(13),
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  permissionButton: {
    backgroundColor: '#FF6B2B',
    paddingHorizontal: sz(24),
    paddingVertical: sz(14),
    borderRadius: sz(12),
  },
});
