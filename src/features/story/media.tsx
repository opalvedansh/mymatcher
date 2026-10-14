import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAudio, getVideo } from '@/utils/optionalModules';
import { sz } from '@/theme/scale';
import { MUSIC_CLIP_SECONDS, type StoryMusic } from './layout';

/**
 * A story's video, filling its box. Playback follows `paused`, and it starts
 * from the beginning each time it mounts. Binaries built before expo-video
 * get a note instead.
 */
export function StoryVideo(props: {
  uri: string;
  paused: boolean;
  muted: boolean;
  fit: 'contain' | 'cover';
  loop?: boolean;
  onLoad?: () => void;
  onError?: () => void;
  onBuffering?: (buffering: boolean) => void;
}) {
  if (!getVideo()) return <NoVideo onLoad={props.onLoad} />;
  return <VideoPlayer {...props} />;
}

function NoVideo({ onLoad }: { onLoad?: () => void }) {
  // Counts as loaded, so the story's timer runs and moves on.
  useEffect(() => {
    onLoad?.();
  }, [onLoad]);
  return (
    <View style={styles.fallback}>
      <Ionicons name="videocam-outline" size={sz(30)} color="rgba(255,255,255,0.6)" />
      <Text style={styles.fallbackText}>Update Matchr to watch video stories</Text>
    </View>
  );
}

function VideoPlayer({
  uri,
  paused,
  muted,
  fit,
  loop = false,
  onLoad,
  onError,
  onBuffering,
}: Parameters<typeof StoryVideo>[0]) {
  const video = getVideo()!;
  const player = video.useVideoPlayer(uri, (p) => {
    p.loop = loop;
    p.muted = muted;
  });
  const callbacks = useRef({ onLoad, onError, onBuffering });
  callbacks.current = { onLoad, onError, onBuffering };

  useEffect(() => {
    let ready = false;
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') {
        if (!ready) {
          ready = true;
          callbacks.current.onLoad?.();
        }
        callbacks.current.onBuffering?.(false);
      } else if (status === 'loading' && ready) {
        callbacks.current.onBuffering?.(true);
      } else if (status === 'error') {
        callbacks.current.onError?.();
      }
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [player, paused]);

  return (
    <video.VideoView
      player={player}
      nativeControls={false}
      contentFit={fit}
      allowsPictureInPicture={false}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />
  );
}

/**
 * Plays a story's song: the chosen 15 seconds of its preview, looped, while
 * `playing`. Silent on binaries without expo-audio.
 */
export function useStoryMusic(music: StoryMusic | null | undefined, playing: boolean) {
  const audio = getAudio();
  const playerRef = useRef<ReturnType<NonNullable<typeof audio>['createAudioPlayer']> | null>(null);
  const preview = music?.preview;
  const start = music?.start ?? 0;
  const startRef = useRef(start);
  startRef.current = start;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  // Whether this player has begun the clip, so a resume carries on from where it paused.
  const startedRef = useRef(false);

  useEffect(() => {
    if (!audio || !preview) return;
    // Stories play their sound with the ringer switch off, like voice notes.
    audio.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    const player = audio.createAudioPlayer({ uri: preview }, { updateInterval: 250 });
    playerRef.current = player;
    startedRef.current = false;
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      // Loop the chosen clip rather than the whole preview.
      if (s.isLoaded && (s.currentTime >= startRef.current + MUSIC_CLIP_SECONDS || s.didJustFinish)) {
        player.seekTo(startRef.current).catch(() => {});
        if (s.didJustFinish && playingRef.current) player.play();
      }
    });
    if (playingRef.current) {
      startedRef.current = true;
      player.seekTo(startRef.current).catch(() => {});
      player.play();
    }
    return () => {
      sub.remove();
      player.remove();
      playerRef.current = null;
    };
  }, [audio, preview]);

  // Moving the clip start (in the editor) jumps there.
  useEffect(() => {
    if (startedRef.current) playerRef.current?.seekTo(start).catch(() => {});
  }, [start]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (playing) {
      if (!startedRef.current) {
        startedRef.current = true;
        player.seekTo(startRef.current).catch(() => {});
      }
      player.play();
    } else {
      player.pause();
    }
  }, [playing]);
}

const styles = StyleSheet.create({
  fallback: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: sz(8),
    backgroundColor: '#111',
  },
  fallbackText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: sz(13),
  },
});
