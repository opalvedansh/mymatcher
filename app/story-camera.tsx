import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Directions, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { BOTTOM_BAR, StoryEditor, type StoryDraft } from '@/features/story/StoryEditor';
import { CloseFriendsSheet, CLOSE_FRIENDS_GREEN } from '@/features/story/StorySheets';
import { useCanvasFrame } from '@/features/story/layout';
import { showAlert } from '@/components/ActionSheet';
import { getMediaLibrary, tapFeedback } from '@/utils/optionalModules';
import { sz } from '@/theme/scale';

const ACCENT = '#FF6B2B';
const MAX_VIDEO_SECONDS = 60;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

type Mode = 'picture' | 'video';
const MODES: { id: Mode; label: string }[] = [
  { id: 'picture', label: 'PHOTO' },
  { id: 'video', label: 'VIDEO' },
];

const SHUTTER = sz(78);
const RING = sz(4);
const GLASS = sz(42);
const MODE_W = sz(76);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export default function StoryCameraScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The viewfinder is the story canvas itself, placed exactly where the
  // editor puts it, so what is framed here is what gets posted.
  const frame = useCanvasFrame(BOTTOM_BAR);
  const reduceMotion = useReducedMotion();

  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [flash, setFlash] = useState<'on' | 'off'>('off');
  const [mode, setMode] = useState<Mode>('picture');
  const [zoom, setZoom] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [closeFriendsOpen, setCloseFriendsOpen] = useState(false);
  const [latestThumb, setLatestThumb] = useState<string | null>(null);
  // undefined: camera; null: a text-only story; otherwise the photo being edited.
  const [draft, setDraft] = useState<StoryDraft | undefined>(undefined);
  const cameraRef = useRef<CameraView>(null);
  const recording = recordingSince !== null;

  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain) requestPermission();
  }, [permission, requestPermission]);

  // The library button shows the newest photo, as in the Camera app, but only
  // when photo access was already given: opening the camera never asks for it.
  useEffect(() => {
    const library = getMediaLibrary();
    if (!library) return;
    let live = true;
    (async () => {
      try {
        const perm = await library.getPermissionsAsync();
        if (!perm.granted) return;
        const [newest] = await new library.Query()
          .orderBy({ key: library.AssetField.CREATION_TIME, ascending: false })
          .limit(1)
          .exe();
        const uri = newest ? await newest.getUri() : null;
        if (live && uri) setLatestThumb(uri);
      } catch {
        // No thumbnail is fine; the icon stands in.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // The recording timer.
  useEffect(() => {
    if (recordingSince === null) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - recordingSince) / 1000)), 250);
    return () => clearInterval(t);
  }, [recordingSince]);

  // ─── Motion ────────────────────────────────────────────────────

  const shutterScale = useSharedValue(1);
  const flashOpacity = useSharedValue(0);
  const ringProgress = useSharedValue(0);
  const modeIndex = useSharedValue(0);

  useEffect(() => {
    const i = MODES.findIndex((m) => m.id === mode);
    modeIndex.value = reduceMotion ? i : withSpring(i, { damping: 18, stiffness: 180 });
  }, [mode, modeIndex, reduceMotion]);

  const shutterStyle = useAnimatedStyle(() => ({ transform: [{ scale: shutterScale.value }] }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));
  // The active mode slides to the centre, under the shutter, like the Camera app.
  const modeTrackStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -modeIndex.value * MODE_W }] }));

  const radius = (SHUTTER - RING) / 2;
  const circumference = 2 * Math.PI * radius;
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - ringProgress.value) }));

  // ─── Actions ───────────────────────────────────────────────────

  const switchMode = useCallback(async (next: Mode) => {
    if (recording || next === mode) return;
    tapFeedback('selection');
    setMode(next);
    // A video records sound when the microphone is allowed, and silently if not.
    if (next === 'video' && !micPermission?.granted && micPermission?.canAskAgain !== false) {
      await requestMicPermission();
    }
  }, [recording, mode, micPermission, requestMicPermission]);

  const toggleRecording = async () => {
    const camera = cameraRef.current;
    if (!camera) return;
    if (recording) {
      camera.stopRecording();
      return;
    }
    const started = Date.now();
    tapFeedback();
    setElapsed(0);
    setRecordingSince(started);
    // The ring fills as the recording uses up its minute.
    ringProgress.value = 0;
    ringProgress.value = withTiming(1, { duration: MAX_VIDEO_SECONDS * 1000, easing: Easing.linear });
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
      cancelAnimation(ringProgress);
      ringProgress.value = 0;
      setRecordingSince(null);
    }
  };

  const takePhoto = async () => {
    if (!cameraRef.current || isCapturing) return;
    try {
      setIsCapturing(true);
      tapFeedback();
      // A quick white flash says the photo was taken.
      if (!reduceMotion) {
        flashOpacity.value = withSequence(withTiming(0.85, { duration: 60 }), withTiming(0, { duration: 260 }));
      }
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

  const handleShutter = () => (mode === 'video' ? toggleRecording() : takePhoto());

  const handlePickImage = async () => {
    if (isCapturing || recording) return;
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

  const flipCamera = useCallback(() => {
    if (recording) return;
    tapFeedback('selection');
    setFacing((f) => (f === 'back' ? 'front' : 'back'));
    setZoom(0);
  }, [recording]);

  // ─── Viewfinder gestures: pinch to zoom, double-tap to flip, swipe for mode ──

  const zoomRef = useRef(0);
  zoomRef.current = zoom;
  const zoomStart = useRef(0);
  const viewfinderGesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => {
        zoomStart.current = zoomRef.current;
      })
      .onUpdate((e) => setZoom(Math.min(1, Math.max(0, zoomStart.current + (e.scale - 1) * 0.25))));
    const doubleTap = Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(2)
      .onEnd((_e, ok) => {
        if (ok) flipCamera();
      });
    const toVideo = Gesture.Fling().runOnJS(true).direction(Directions.LEFT).onEnd(() => switchMode('video'));
    const toPhoto = Gesture.Fling().runOnJS(true).direction(Directions.RIGHT).onEnd(() => switchMode('picture'));
    return Gesture.Race(pinch, doubleTap, toVideo, toPhoto);
  }, [flipCamera, switchMode]);

  // ─── Editor ────────────────────────────────────────────────────

  if (draft !== undefined) {
    return <StoryEditor draft={draft} onClose={() => setDraft(undefined)} onPosted={() => router.back()} />;
  }

  // ─── Permission ────────────────────────────────────────────────

  if (!permission) return <View style={styles.screen} />;

  if (!permission.granted) {
    const blocked = !permission.canAskAgain;
    return (
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={sz(10)}
          style={styles.permClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={sz(28)} color="#FFF" />
        </Pressable>
        <View style={styles.permBody}>
          <View style={styles.permIcon}>
            <Ionicons name="camera" size={sz(34)} color={ACCENT} />
          </View>
          <Text style={styles.permTitle}>Share what you're working on</Text>
          <Text style={styles.permText}>
            {blocked
              ? 'Camera access is off for Matchr. Turn it on in Settings to take photos and videos for your story.'
              : 'Allow camera access to take photos and videos for your story.'}
          </Text>
          <Pressable
            onPress={blocked ? () => Linking.openSettings() : requestPermission}
            style={({ pressed }) => [styles.permPrimary, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.permPrimaryText}>{blocked ? 'Open Settings' : 'Allow camera'}</Text>
          </Pressable>
          <View style={styles.permAlternatives}>
            <Pressable
              onPress={handlePickImage}
              style={({ pressed }) => [styles.permAlt, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Ionicons name="images-outline" size={sz(18)} color="#FFF" />
              <Text style={styles.permAltText}>Library</Text>
            </Pressable>
            <Pressable
              onPress={() => setDraft(null)}
              style={({ pressed }) => [styles.permAlt, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.permAa}>Aa</Text>
              <Text style={styles.permAltText}>Text story</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // ─── Camera ────────────────────────────────────────────────────

  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <View style={styles.screen}>
      <View style={[styles.viewfinder, { top: frame.top, left: frame.left, width: frame.width, height: frame.height }]}>
        <GestureDetector gesture={viewfinderGesture}>
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              flash={flash}
              zoom={zoom}
              mode={mode}
              videoQuality="720p"
              mute={mode === 'video' && !micPermission?.granted}
            />
          </View>
        </GestureDetector>

        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, flashStyle]} />

        {/* Top: close and flash; while recording, the timer in the middle. */}
        <View style={styles.topRow} pointerEvents="box-none">
          <View style={styles.topSlot}>
            {!recording && <GlassButton icon="close" iconSize={sz(26)} label="Close" onPress={() => router.back()} />}
          </View>
          {recording && (
            <View
              style={styles.timer}
              accessibilityLiveRegion="polite"
              accessibilityLabel={`Recording, ${mm} minutes ${ss} seconds`}
            >
              <View style={styles.timerDot} />
              <Text style={styles.timerText}>{mm}:{ss}</Text>
            </View>
          )}
          <View style={[styles.topSlot, styles.topSlotRight]}>
            {!recording && (
              <GlassButton
                icon={flash === 'on' ? 'flash' : 'flash-off'}
                label={flash === 'on' ? 'Flash on' : 'Flash off'}
                onPress={() => setFlash((f) => (f === 'on' ? 'off' : 'on'))}
                active={flash === 'on'}
              />
            )}
          </View>
        </View>

        {/* Tools down the left side. */}
        {!recording && (
          <View style={styles.rail} pointerEvents="box-none">
            <RailItem label="Create" onPress={() => setDraft(null)}>
              <Text style={styles.railAa}>Aa</Text>
            </RailItem>
            <RailItem label="Close Friends" onPress={() => setCloseFriendsOpen(true)}>
              <Ionicons name="star" size={sz(17)} color={CLOSE_FRIENDS_GREEN} />
            </RailItem>
          </View>
        )}

        {/* Bottom: library, shutter, flip. */}
        <View style={styles.controls} pointerEvents="box-none">
          <Pressable
            onPress={handlePickImage}
            disabled={isCapturing || recording}
            style={({ pressed }) => [styles.library, recording && styles.hidden, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Choose from library"
          >
            {latestThumb ? (
              <Image source={{ uri: latestThumb }} style={styles.libraryThumb} contentFit="cover" />
            ) : (
              <BlurView intensity={40} tint="dark" style={styles.libraryBlur}>
                <Ionicons name="images-outline" size={sz(20)} color="#FFF" />
              </BlurView>
            )}
          </Pressable>

          <Pressable
            onPress={handleShutter}
            onPressIn={() => {
              if (!reduceMotion) shutterScale.value = withSpring(0.9, { damping: 15, stiffness: 400 });
            }}
            onPressOut={() => {
              if (!reduceMotion) shutterScale.value = withSpring(1, { damping: 12, stiffness: 300 });
            }}
            disabled={isCapturing}
            accessibilityRole="button"
            accessibilityLabel={mode === 'video' ? (recording ? 'Stop recording' : 'Record video') : 'Take photo'}
          >
            <Animated.View style={[styles.shutter, shutterStyle]}>
              <Svg width={SHUTTER} height={SHUTTER} style={StyleSheet.absoluteFill}>
                <Circle cx={SHUTTER / 2} cy={SHUTTER / 2} r={radius} stroke="#FFF" strokeWidth={RING} fill="none" />
                <AnimatedCircle
                  cx={SHUTTER / 2}
                  cy={SHUTTER / 2}
                  r={radius}
                  stroke={ACCENT}
                  strokeWidth={RING}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${circumference} ${circumference}`}
                  animatedProps={ringProps}
                  transform={`rotate(-90 ${SHUTTER / 2} ${SHUTTER / 2})`}
                />
              </Svg>
              <View style={[styles.shutterCore, mode === 'video' && styles.shutterCoreVideo, recording && styles.shutterCoreRecording]}>
                {isCapturing && <ActivityIndicator color="#111" />}
              </View>
            </Animated.View>
          </Pressable>

          <View style={recording ? styles.hidden : undefined} pointerEvents={recording ? 'none' : 'auto'}>
            <GlassButton icon="camera-reverse-outline" iconSize={sz(24)} label="Flip camera" onPress={flipCamera} size={sz(48)} />
          </View>
        </View>
      </View>

      {/* Modes, under the frame. */}
      <View
        style={[styles.modeArea, { top: frame.top + frame.height, height: BOTTOM_BAR }]}
        pointerEvents={recording ? 'none' : 'box-none'}
      >
        {!recording && (
          <>
            <Animated.View style={[styles.modeTrack, modeTrackStyle]}>
              {MODES.map((m) => {
                const on = m.id === mode;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => switchMode(m.id)}
                    style={styles.modeItem}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.modeText, on && styles.modeTextOn]}>{m.label}</Text>
                  </Pressable>
                );
              })}
            </Animated.View>
            <View style={styles.modeMarker} />
          </>
        )}
      </View>

      <CloseFriendsSheet
        visible={closeFriendsOpen}
        onClose={() => setCloseFriendsOpen(false)}
        onSaved={() => setCloseFriendsOpen(false)}
      />
    </View>
  );
}

/** A round frosted control over the camera image. */
function GlassButton({
  icon,
  label,
  onPress,
  iconSize = sz(22),
  size = GLASS,
  active = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  iconSize?: number;
  size?: number;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={sz(6)}
      style={({ pressed }) => pressed && styles.pressed}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <BlurView intensity={40} tint="dark" style={[styles.glass, { width: size, height: size, borderRadius: size / 2 }]}>
        <Ionicons name={icon} size={iconSize} color={active ? '#FFD60A' : '#FFF'} />
      </BlurView>
    </Pressable>
  );
}

function RailItem({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.railItem, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <BlurView intensity={40} tint="dark" style={[styles.glass, styles.railIcon]}>
        {children}
      </BlurView>
      <Text style={styles.railLabel}>{label}</Text>
    </Pressable>
  );
}

const textShadow = {
  textShadowColor: 'rgba(0,0,0,0.55)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: sz(3),
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  pressed: {
    opacity: 0.7,
  },
  hidden: {
    opacity: 0,
  },
  viewfinder: {
    position: 'absolute',
    borderRadius: sz(20),
    overflow: 'hidden',
    backgroundColor: '#161616',
  },
  flash: {
    backgroundColor: '#FFF',
  },
  topRow: {
    position: 'absolute',
    top: sz(12),
    left: sz(12),
    right: sz(12),
    height: GLASS,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topSlot: {
    width: GLASS,
  },
  topSlotRight: {
    alignItems: 'flex-end',
  },
  glass: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(20,20,20,0.25)',
  },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(7),
    height: sz(32),
    paddingHorizontal: sz(14),
    borderRadius: sz(16),
    backgroundColor: 'rgba(237,73,86,0.92)',
  },
  timerDot: {
    width: sz(7),
    height: sz(7),
    borderRadius: sz(4),
    backgroundColor: '#FFF',
  },
  timerText: {
    color: '#FFF',
    fontSize: sz(15),
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  rail: {
    position: 'absolute',
    left: sz(12),
    top: sz(12) + GLASS + sz(24),
    gap: sz(14),
  },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(10),
  },
  railIcon: {
    width: sz(40),
    height: sz(40),
    borderRadius: sz(20),
  },
  railAa: {
    color: '#FFF',
    fontSize: sz(16),
    fontWeight: '800',
  },
  railLabel: {
    color: '#FFF',
    fontSize: sz(14),
    fontWeight: '600',
    ...textShadow,
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: sz(22),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sz(26),
  },
  library: {
    width: sz(44),
    height: sz(44),
    borderRadius: sz(11),
    borderWidth: 2,
    borderColor: '#FFF',
    overflow: 'hidden',
  },
  libraryThumb: {
    width: '100%',
    height: '100%',
  },
  libraryBlur: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,20,0.25)',
  },
  shutter: {
    width: SHUTTER,
    height: SHUTTER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterCore: {
    width: SHUTTER - RING * 2 - sz(10),
    height: SHUTTER - RING * 2 - sz(10),
    borderRadius: (SHUTTER - RING * 2 - sz(10)) / 2,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterCoreVideo: {
    backgroundColor: ACCENT,
  },
  // A rounded square while recording: tap again to stop.
  shutterCoreRecording: {
    width: sz(28),
    height: sz(28),
    borderRadius: sz(7),
  },
  modeArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  modeTrack: {
    position: 'absolute',
    top: sz(14),
    left: '50%',
    marginLeft: -MODE_W / 2,
    flexDirection: 'row',
  },
  modeItem: {
    width: MODE_W,
    alignItems: 'center',
    paddingVertical: sz(8),
  },
  modeText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: sz(13),
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  modeTextOn: {
    color: '#FFF',
  },
  modeMarker: {
    position: 'absolute',
    top: sz(48),
    left: '50%',
    marginLeft: -sz(2.5),
    width: sz(5),
    height: sz(5),
    borderRadius: sz(3),
    backgroundColor: ACCENT,
  },
  permClose: {
    marginLeft: sz(16),
    marginTop: sz(8),
    width: sz(44),
    height: sz(44),
    alignItems: 'center',
    justifyContent: 'center',
  },
  permBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: sz(32),
    paddingBottom: sz(60),
  },
  permIcon: {
    width: sz(76),
    height: sz(76),
    borderRadius: sz(38),
    backgroundColor: 'rgba(255,107,43,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: sz(22),
  },
  permTitle: {
    color: '#FFF',
    fontSize: sz(22),
    fontWeight: '800',
    textAlign: 'center',
  },
  permText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: sz(15),
    lineHeight: sz(21),
    textAlign: 'center',
    marginTop: sz(10),
  },
  permPrimary: {
    marginTop: sz(28),
    height: sz(50),
    alignSelf: 'stretch',
    borderRadius: sz(25),
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permPrimaryText: {
    color: '#FFF',
    fontSize: sz(16),
    fontWeight: '700',
  },
  permAlternatives: {
    flexDirection: 'row',
    gap: sz(12),
    marginTop: sz(14),
    alignSelf: 'stretch',
  },
  permAlt: {
    flex: 1,
    height: sz(48),
    borderRadius: sz(24),
    flexDirection: 'row',
    gap: sz(8),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  permAltText: {
    color: '#FFF',
    fontSize: sz(15),
    fontWeight: '600',
  },
  permAa: {
    color: '#FFF',
    fontSize: sz(15),
    fontWeight: '800',
  },
});
