import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

// Native modules added after the first 1.0.0 binaries shipped. runtimeVersion
// follows the app version, so an over-the-air update can reach a binary built
// before these existed, and importing one of these packages there throws the
// moment the file loads. They are loaded only when the native side is present;
// otherwise the feature is hidden until the app is updated from the store.
// Web has no native modules: the packages' web implementations are used.
const hasNative = (name: string) => Platform.OS === 'web' || requireOptionalNativeModule(name) != null;

function lazy<T>(nativeName: string, load: () => T): () => T | null {
  let loaded: T | null | undefined;
  return () => {
    if (loaded === undefined) {
      try {
        loaded = hasNative(nativeName) ? load() : null;
      } catch (err) {
        console.warn(`[optionalModules] ${nativeName} unavailable`, err);
        loaded = null;
      }
    }
    return loaded;
  };
}

export const getAudio = lazy<typeof import('expo-audio')>('ExpoAudio', () => require('expo-audio'));
export const getDocumentPicker = lazy<typeof import('expo-document-picker')>('ExpoDocumentPicker', () => require('expo-document-picker'));
export const getClipboard = lazy<typeof import('expo-clipboard')>('ExpoClipboard', () => require('expo-clipboard'));
export const getVideo = lazy<typeof import('expo-video')>('ExpoVideo', () => require('expo-video'));
export const getHaptics = lazy<typeof import('expo-haptics')>('ExpoHaptics', () => require('expo-haptics'));
export const getImageManipulator = lazy<typeof import('expo-image-manipulator')>('ExpoImageManipulator', () => require('expo-image-manipulator'));
export const getMediaLibrary = lazy<typeof import('expo-media-library')>('ExpoMediaLibrary', () => require('expo-media-library'));

let viewShot: typeof import('react-native-view-shot') | null | undefined;
/**
 * Captures a view as an image (saving a story to the camera roll). A React
 * Native module rather than an Expo one, so it is looked up differently, and
 * it has no web implementation.
 */
export function getViewShot() {
  if (viewShot === undefined) {
    const present = Platform.OS !== 'web'
      && (NativeModules.RNViewShot != null || TurboModuleRegistry.get('RNViewShot') != null);
    try {
      viewShot = present ? require('react-native-view-shot') : null;
    } catch (err) {
      console.warn('[optionalModules] RNViewShot unavailable', err);
      viewShot = null;
    }
  }
  return viewShot ?? null;
}

/** Saving a story needs both the view capture and the photo library. */
export function canSaveToCameraRoll() {
  return !!getViewShot() && !!getMediaLibrary();
}

/** Voice notes need a microphone API; some browsers (and old binaries) have none. */
export function canRecordAudio() {
  if (!getAudio()) return false;
  if (Platform.OS !== 'web') return true;
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

/** A light tap of feedback; silently nothing where haptics are unsupported. */
export function tapFeedback(kind: 'light' | 'selection' = 'light') {
  const haptics = getHaptics();
  if (!haptics || Platform.OS === 'web') return;
  const run = kind === 'selection'
    ? haptics.selectionAsync()
    : haptics.impactAsync(haptics.ImpactFeedbackStyle.Light);
  run.catch(() => {});
}
