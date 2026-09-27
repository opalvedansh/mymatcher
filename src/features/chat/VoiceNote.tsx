import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAudio } from '@/utils/optionalModules';
import { sz } from '@/theme/scale';
import { formatDuration } from './format';

/**
 * Voice-note playback for a whole conversation through ONE audio player, as
 * on WhatsApp: starting a note stops the previous one, and a long thread does
 * not hold an audio player per bubble.
 */
interface PlaybackSnapshot {
  activeId: string | null;
  playing: boolean;
  loading: boolean;
  positionMs: number;
  durationMs: number;
  rate: number;
}

interface VoicePlayback {
  subscribe(listener: () => void): () => void;
  get(): PlaybackSnapshot;
  toggle(id: string, url: string): void;
  seek(id: string, fraction: number): void;
  cycleRate(): void;
}

const IDLE: PlaybackSnapshot = { activeId: null, playing: false, loading: false, positionMs: 0, durationMs: 0, rate: 1 };
const RATES = [1, 1.5, 2];

const VoicePlaybackContext = createContext<VoicePlayback | null>(null);

/** Mount once around a conversation. Renders children only when audio is unavailable. */
export function VoicePlaybackProvider({ children }: { children: React.ReactNode }) {
  if (!getAudio()) return <>{children}</>;
  return <AudioBackedProvider>{children}</AudioBackedProvider>;
}

function AudioBackedProvider({ children }: { children: React.ReactNode }) {
  const audio = getAudio()!;
  const player = audio.useAudioPlayer(null, { updateInterval: 100 });
  const status = audio.useAudioPlayerStatus(player);

  const snapshot = useRef<PlaybackSnapshot>(IDLE);
  const listeners = useRef(new Set<() => void>());
  const pendingSeek = useRef<number | null>(null);

  const publish = useCallback((next: Partial<PlaybackSnapshot>) => {
    snapshot.current = { ...snapshot.current, ...next };
    listeners.current.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    // Voice notes play through the speaker even with the ringer switch off.
    audio.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
  }, [audio]);

  useEffect(() => {
    if (!snapshot.current.activeId) return;
    const durationMs = status.duration ? status.duration * 1000 : snapshot.current.durationMs;
    if (status.isLoaded && pendingSeek.current !== null && durationMs) {
      player.seekTo((pendingSeek.current * durationMs) / 1000).catch(() => {});
      pendingSeek.current = null;
    }
    if (status.didJustFinish) {
      player.pause();
      player.seekTo(0).catch(() => {});
      publish({ playing: false, positionMs: 0, loading: false });
      return;
    }
    publish({
      playing: status.playing,
      loading: !status.isLoaded || (status.isBuffering && !status.playing),
      positionMs: status.currentTime * 1000,
      durationMs,
    });
  }, [status, player, publish]);

  const api = useMemo<VoicePlayback>(() => ({
    subscribe(listener) {
      listeners.current.add(listener);
      return () => listeners.current.delete(listener);
    },
    get: () => snapshot.current,
    toggle(id, url) {
      const current = snapshot.current;
      if (current.activeId === id) {
        if (player.playing) player.pause();
        else player.play();
        return;
      }
      player.replace({ uri: url });
      player.setPlaybackRate(current.rate);
      publish({ activeId: id, playing: true, loading: true, positionMs: 0, durationMs: 0 });
      player.play();
    },
    seek(id, fraction) {
      const current = snapshot.current;
      // Only the note that is playing (or loading) can be scrubbed.
      if (current.activeId !== id) return;
      if (!current.durationMs) {
        pendingSeek.current = fraction;
        return;
      }
      player.seekTo((fraction * current.durationMs) / 1000).catch(() => {});
      publish({ positionMs: fraction * current.durationMs });
    },
    cycleRate() {
      const rate = RATES[(RATES.indexOf(snapshot.current.rate) + 1) % RATES.length];
      player.setPlaybackRate(rate);
      publish({ rate });
    },
  }), [player, publish]);

  return <VoicePlaybackContext.Provider value={api}>{children}</VoicePlaybackContext.Provider>;
}

/** This note's slice of the shared playback state; re-renders only this bubble. */
function useNotePlayback(id: string): PlaybackSnapshot {
  const ctx = useContext(VoicePlaybackContext);
  const pick = useCallback(() => {
    const s = ctx?.get() ?? IDLE;
    return s.activeId === id ? s : { ...IDLE, rate: s.rate };
  }, [ctx, id]);
  const [state, setState] = useState(pick);
  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe(() => {
      const next = pick();
      setState((prev) =>
        prev.activeId === next.activeId && prev.playing === next.playing && prev.loading === next.loading
          && Math.abs(prev.positionMs - next.positionMs) < 50 && prev.durationMs === next.durationMs && prev.rate === next.rate
          ? prev
          : next);
    });
  }, [ctx, pick]);
  return state;
}

const BARS = 36;

/** Evenly resampled loudness bars; a gentle pseudo-random shape when the recorder gave none. */
function barsFor(id: string, waveform?: number[]) {
  if (waveform && waveform.length >= 4) {
    return Array.from({ length: BARS }, (_, i) => {
      const v = waveform[Math.floor((i / BARS) * waveform.length)] ?? 0;
      return Math.max(0.12, Math.min(1, v));
    });
  }
  let seed = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return Array.from({ length: BARS }, () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return 0.2 + ((seed >>> 16) % 1000) / 1000 * 0.7;
  });
}

interface VoiceNoteProps {
  id: string;
  url: string | null;
  durationMs?: number;
  waveform?: number[];
  isMe: boolean;
  /** Upload progress 0..1 while sending, else undefined. */
  uploading?: number;
}

export function VoiceNote({ id, url, durationMs, waveform, isMe, uploading }: VoiceNoteProps) {
  const ctx = useContext(VoicePlaybackContext);
  const state = useNotePlayback(id);
  const bars = useMemo(() => barsFor(id, waveform), [id, waveform]);
  const [trackWidth, setTrackWidth] = useState(1);

  const active = state.activeId === id;
  const total = (active && state.durationMs) || durationMs || 0;
  const progress = active && total ? Math.min(1, state.positionMs / total) : 0;
  const played = isMe ? 'rgba(255,255,255,0.95)' : '#FF8A55';
  const unplayed = isMe ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.28)';
  const canPlay = !!ctx && !!url && uploading === undefined;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => canPlay && ctx!.toggle(id, url!)}
        disabled={!canPlay}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={state.playing ? 'Pause voice message' : 'Play voice message'}
        style={[styles.playButton, isMe ? styles.playMe : styles.playThem]}
      >
        {uploading !== undefined ? (
          <Text style={styles.uploadText}>{Math.round(uploading * 100)}%</Text>
        ) : active && state.loading ? (
          <ActivityIndicator size="small" color="#FFF" />
        ) : (
          <Ionicons name={state.playing ? 'pause' : 'play'} size={sz(20)} color="#FFF" style={!state.playing && { marginLeft: 2 }} />
        )}
      </Pressable>

      <View style={styles.body}>
        <Pressable
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width || 1)}
          onPress={(e) => canPlay && ctx!.seek(id, Math.max(0, Math.min(1, e.nativeEvent.locationX / trackWidth)))}
          disabled={!canPlay}
          style={styles.wave}
          accessibilityRole="adjustable"
          accessibilityLabel="Voice message position"
        >
          {bars.map((h, i) => (
            <View
              key={i}
              style={[styles.bar, { height: sz(4) + h * sz(20), backgroundColor: i / BARS < progress ? played : unplayed }]}
            />
          ))}
        </Pressable>
        <View style={styles.metaRow}>
          <Text style={[styles.time, isMe ? styles.timeMe : styles.timeThem]}>
            {formatDuration(active && state.positionMs > 0 ? state.positionMs : total)}
          </Text>
          {active && (
            <Pressable onPress={() => ctx?.cycleRate()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Playback speed">
              <Text style={[styles.rate, isMe && styles.rateMe]}>{state.rate}×</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: sz(10), width: sz(236), paddingVertical: sz(2) },
  playButton: { width: sz(40), height: sz(40), borderRadius: sz(20), justifyContent: 'center', alignItems: 'center' },
  playMe: { backgroundColor: 'rgba(0,0,0,0.18)' },
  playThem: { backgroundColor: '#FF6B2B' },
  uploadText: { color: '#FFF', fontSize: sz(11), fontWeight: '700', fontVariant: ['tabular-nums'] },
  body: { flex: 1 },
  wave: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: sz(28) },
  bar: { width: sz(3), borderRadius: sz(1.5) },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: sz(8), marginTop: sz(2) },
  time: { fontSize: sz(11), fontVariant: ['tabular-nums'] },
  timeMe: { color: 'rgba(255,255,255,0.85)' },
  timeThem: { color: '#9A9A9A' },
  rate: {
    fontSize: sz(11), fontWeight: '700', color: '#FFF', backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: sz(6), paddingVertical: 1, borderRadius: sz(8), overflow: 'hidden',
  },
  rateMe: { backgroundColor: 'rgba(0,0,0,0.18)' },
});
