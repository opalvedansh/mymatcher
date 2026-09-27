import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { showAlert } from '@/components/ActionSheet';
import { getAudio, tapFeedback } from '@/utils/optionalModules';
import { sz } from '@/theme/scale';
import { formatDuration } from './format';
import type { LocalFile } from './upload';

const ACCENT = '#FF6B2B';
const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 15 * 60 * 1000;
const WAVEFORM_BARS = 48;
// A browser recorder that fails to encode stops on its own right after it
// starts; this is how long to wait before calling a start successful.
const WEB_START_CHECK_MS = 700;
// expo-audio's web stop() waits for a data event that a failed recorder never
// fires; never let that hold the composer hostage.
const STOP_TIMEOUT_MS = 4000;

/**
 * Formats to try in a browser, best first. MP4/AAC plays everywhere,
 * iPhones included, so it goes first; some Chromium builds claim to support
 * it and then fail the moment recording starts, hence the fallbacks.
 */
function webRecordingMimes(): string[] {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return [];
  const first = (types: string[]) => types.find((type) => MediaRecorder.isTypeSupported(type));
  return [
    first(['audio/mp4;codecs=mp4a.40.2', 'audio/mp4']),
    first(['audio/webm;codecs=opus', 'audio/webm']),
    first(['audio/ogg;codecs=opus']),
  ].filter((type): type is string => !!type);
}

/** Loudness in dBFS (-160..0) to a 0..1 bar height; quiet rooms sit near 0. */
const level = (db?: number) => (db === undefined ? 0 : Math.max(0, Math.min(1, (db + 55) / 55)));

function downsample(values: number[], count: number) {
  if (!values.length) return [];
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i / count) * values.length);
    const to = Math.max(from + 1, Math.floor(((i + 1) / count) * values.length));
    const slice = values.slice(from, to);
    return Math.round((Math.max(...slice) || 0) * 100) / 100;
  });
}

interface Props {
  onSend: (file: LocalFile) => void;
  onCancel: () => void;
  /** Tells the other person "recording audio…". */
  onRecordingChange?: (recording: boolean) => void;
}

/**
 * Replaces the composer while recording: it starts on mount, and the person
 * either sends or discards. Mount only when getAudio() is available.
 */
export function VoiceRecorderBar(props: Props) {
  const webMimes = useMemo(() => (Platform.OS === 'web' ? webRecordingMimes() : []), []);
  const [attempt, setAttempt] = useState(0);
  const { onCancel } = props;

  const unsupported = Platform.OS === 'web' && attempt >= webMimes.length;
  useEffect(() => {
    if (!unsupported) return;
    showAlert('Could not record', 'This browser cannot record voice messages. Try the Matchr app or another browser.');
    onCancel();
  }, [unsupported, onCancel]);
  if (unsupported) return null;

  return (
    <RecorderSession
      key={attempt}
      {...props}
      webMime={webMimes[attempt]}
      onFormatFailed={() => setAttempt((a) => a + 1)}
    />
  );
}

function RecorderSession({ onSend, onCancel, onRecordingChange, webMime, onFormatFailed }: Props & {
  webMime?: string;
  onFormatFailed: () => void;
}) {
  const audio = getAudio()!;
  const options = useMemo(() => ({
    ...audio.RecordingPresets.HIGH_QUALITY,
    // Voice needs neither stereo nor 128 kbps: this keeps a minute near 0.5 MB.
    numberOfChannels: 1,
    bitRate: 64000,
    isMeteringEnabled: true,
    web: { mimeType: webMime, bitsPerSecond: 64000 },
  }), [audio, webMime]);
  const recorder = audio.useAudioRecorder(options);
  const state = audio.useAudioRecorderState(recorder, 100);

  const [started, setStarted] = useState(false);
  const levels = useRef<number[]>([]);
  const finished = useRef(false);
  const pulse = useRef(new Animated.Value(1)).current;
  const [recent, setRecent] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    let startCheck: ReturnType<typeof setTimeout> | undefined;
    // Effects can run again on the same mounted component (Strict Mode, Fast
    // Refresh); each run is a fresh recording.
    finished.current = false;
    levels.current = [];
    (async () => {
      try {
        const permission = await audio.requestRecordingPermissionsAsync();
        if (!permission.granted) {
          showAlert(
            'Microphone access needed',
            Platform.OS === 'web'
              ? 'Allow microphone access in your browser to record voice messages.'
              : 'Allow microphone access for Matchr in Settings to record voice messages.',
          );
          if (!cancelled) onCancel();
          return;
        }
        await audio.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        if (cancelled) return;
        recorder.record();
        tapFeedback();
        setStarted(true);
        onRecordingChange?.(true);
        if (Platform.OS === 'web') {
          startCheck = setTimeout(() => {
            if (!cancelled && !finished.current && !recorder.isRecording) {
              finished.current = true;
              onFormatFailed();
            }
          }, WEB_START_CHECK_MS);
        }
      } catch (err) {
        console.warn('[VoiceRecorder] could not start', err);
        if (cancelled) return;
        if (Platform.OS === 'web') {
          onFormatFailed();
        } else {
          showAlert('Could not record', 'The microphone is not available right now.');
          onCancel();
        }
      }
    })();
    return () => {
      cancelled = true;
      if (startCheck) clearTimeout(startCheck);
      if (!finished.current) {
        finished.current = true;
        // The hook may already have released the recorder on unmount.
        try {
          recorder.stop().catch(() => {});
        } catch {
          // Released: the recording stopped with it.
        }
      }
      onRecordingChange?.(false);
      // Back to playback mode so voice notes use the speaker, not the earpiece.
      audio.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    };
    // Starts once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.25, duration: 600, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    if (!state.isRecording) return;
    const v = level(state.metering);
    levels.current.push(v);
    setRecent((prev) => [...prev.slice(-27), v]);
    if (state.durationMillis >= MAX_DURATION_MS) finish(true);
    // finish is stable enough for this: it only reads refs and props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.durationMillis, state.isRecording]);

  async function finish(send: boolean) {
    if (finished.current) return;
    finished.current = true;
    // Ask the recorder itself: the polled state can lag (a throttled
    // background tab polls once a second or less).
    let durationMs = state.durationMillis;
    try {
      durationMs = Math.max(durationMs, recorder.getStatus().durationMillis || 0);
    } catch {
      // Keep the polled value.
    }
    try {
      await Promise.race([recorder.stop(), new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS))]);
    } catch {
      // Stopping a recorder that failed to start: nothing to send.
    }
    onRecordingChange?.(false);
    if (!send) {
      onCancel();
      return;
    }
    const uri = recorder.uri;
    if (!uri) {
      showAlert('Could not save the recording', 'Please try again.');
      onCancel();
      return;
    }
    if (durationMs < MIN_DURATION_MS) {
      showAlert('Too short', 'Record for at least a second.');
      onCancel();
      return;
    }
    const measured = levels.current.some((v) => v > 0);
    onSend({
      kind: 'audio',
      uri,
      // Native records AAC in MPEG-4 (.m4a); a browser's own type is read from the file.
      mime: Platform.OS === 'web' ? '' : 'audio/mp4',
      name: Platform.OS === 'web' ? undefined : 'voice-message.m4a',
      duration_ms: Math.round(durationMs),
      waveform: measured ? downsample(levels.current, WAVEFORM_BARS) : undefined,
    });
  }

  return (
    <View style={styles.bar}>
      <Pressable
        onPress={() => finish(false)}
        hitSlop={8}
        style={styles.iconButton}
        accessibilityRole="button"
        accessibilityLabel="Discard voice message"
      >
        <Ionicons name="trash-outline" size={sz(22)} color="#FF6B6B" />
      </Pressable>

      <View style={styles.center}>
        <Animated.View style={[styles.dot, { opacity: pulse }]} />
        <Text style={styles.timer} accessibilityLiveRegion="polite">
          {started ? formatDuration(state.durationMillis) : 'Starting…'}
        </Text>
        <View style={styles.levels}>
          {recent.map((v, i) => (
            <View key={i} style={[styles.level, { height: sz(3) + v * sz(22) }]} />
          ))}
        </View>
      </View>

      <Pressable
        onPress={() => finish(true)}
        disabled={!started}
        style={({ pressed }) => [styles.send, !started && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.92 }] }]}
        accessibilityRole="button"
        accessibilityLabel="Send voice message"
      >
        <Ionicons name="arrow-up" size={sz(22)} color="#FFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(8),
    paddingHorizontal: sz(12),
    paddingTop: sz(8),
    paddingBottom: sz(10),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#121212',
  },
  iconButton: { width: sz(44), height: sz(44), borderRadius: sz(22), justifyContent: 'center', alignItems: 'center' },
  center: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(10),
    minHeight: sz(44),
    paddingHorizontal: sz(14),
    borderRadius: sz(22),
    backgroundColor: '#1E1E1E',
    overflow: 'hidden',
  },
  dot: { width: sz(10), height: sz(10), borderRadius: sz(5), backgroundColor: '#FF3B30' },
  timer: { color: '#FFF', fontSize: sz(15), fontWeight: '600', fontVariant: ['tabular-nums'], minWidth: sz(44) },
  levels: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: sz(2), height: sz(28) },
  level: { width: sz(3), borderRadius: sz(1.5), backgroundColor: 'rgba(255,255,255,0.55)' },
  send: {
    width: sz(44), height: sz(44), borderRadius: sz(22), backgroundColor: ACCENT,
    justifyContent: 'center', alignItems: 'center',
  },
});
