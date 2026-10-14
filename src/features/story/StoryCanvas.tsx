import React, { memo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { G, Path } from 'react-native-svg';
import {
  CANVAS_H,
  CANVAS_W,
  FILTERS,
  FONTS,
  contrastOn,
  type CanvasFrame,
  type Layer,
  type StoryBackground,
  type StoryLayout,
  type StoryPhoto,
  type Stroke,
  type StoryMusic,
  type TextLayer,
} from './layout';
import { StoryVideo } from './media';
import { Icon } from './icons';

// The pieces of a story, drawn at canvas scale `k` (screen points per canvas
// unit). The viewer draws them as they are; the editor wraps the photo and the
// layers in gestures and draws them with these same components, so what the
// author sees is what viewers get.

export const StoryBackgroundView = memo(function StoryBackgroundView({
  bg,
  mediaUri,
}: {
  bg: StoryBackground;
  mediaUri: string | null;
}) {
  if (bg.kind === 'blur' && mediaUri) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Image source={{ uri: mediaUri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} cachePolicy="memory-disk" />
        <View style={[StyleSheet.absoluteFill, styles.blurShade]} />
      </View>
    );
  }
  const colors = bg.kind === 'gradient' ? bg.colors : (['#262626', '#0F0F0F'] as [string, string]);
  return (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
  );
});

/** The photo's box at scale 1, before its move/zoom/turn. */
export function photoBoxStyle(photo: StoryPhoto, k: number): ViewStyle {
  return {
    position: 'absolute',
    left: (photo.x - photo.w / 2) * k,
    top: (photo.y - photo.h / 2) * k,
    width: photo.w * k,
    height: photo.h * k,
  };
}

/** Playback of a video story's media. */
export type VideoPlayback = { paused: boolean; muted: boolean; loop?: boolean; onBuffering?: (buffering: boolean) => void };

/** The photo (or video) with its filter, filling whatever box it is put in. */
export const PhotoContent = memo(function PhotoContent({
  uri,
  photo,
  fit = 'contain',
  video,
  onLoad,
  onError,
}: {
  uri: string;
  photo: StoryPhoto;
  /** `cover` for the filter thumbnails; the photo's box already has its aspect ratio. */
  fit?: 'contain' | 'cover';
  /** Set when the media is a video. */
  video?: VideoPlayback;
  onLoad?: () => void;
  onError?: () => void;
}) {
  const passes = FILTERS[photo.filter]?.passes ?? [];
  return (
    // Isolated so the filter blends only with the photo, not the background.
    <View style={styles.photoInner}>
      {video ? (
        <StoryVideo
          uri={uri}
          fit={fit}
          paused={video.paused}
          muted={video.muted}
          loop={video.loop}
          onBuffering={video.onBuffering}
          onLoad={onLoad}
          onError={onError}
        />
      ) : (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit={fit}
          cachePolicy="memory-disk"
          onLoad={onLoad}
          onError={onError}
        />
      )}
      {passes.map((p, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: p.color, opacity: p.opacity, mixBlendMode: p.blend }]}
        />
      ))}
    </View>
  );
});

export const StrokesView = memo(function StrokesView({
  strokes,
  frame,
  live,
}: {
  strokes: Stroke[];
  frame: Pick<CanvasFrame, 'width' | 'height'>;
  /** The stroke still being drawn, kept separate so the finished ones don't re-render. */
  live?: Stroke | null;
}) {
  if (!strokes.length && !live) return null;
  return (
    <Svg
      width={frame.width}
      height={frame.height}
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      {strokes.map((s, i) => <StrokePath key={i} stroke={s} />)}
      {live && <StrokePath stroke={live} />}
    </Svg>
  );
});

const StrokePath = memo(function StrokePath({ stroke: s }: { stroke: Stroke }) {
  const common = { d: s.d, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (s.brush) {
    case 'marker':
      return <Path {...common} stroke={s.color} strokeWidth={s.width} strokeOpacity={0.55} strokeLinecap="square" />;
    case 'neon':
      return (
        <G>
          <Path {...common} stroke={s.color} strokeWidth={s.width * 2.6} strokeOpacity={0.25} />
          <Path {...common} stroke={s.color} strokeWidth={s.width * 1.5} strokeOpacity={0.55} />
          <Path {...common} stroke="#FFFFFF" strokeWidth={s.width * 0.6} />
        </G>
      );
    default:
      return <Path {...common} stroke={s.color} strokeWidth={s.width} />;
  }
});

/**
 * A layer is laid out centred in a box much bigger than itself, placed so the
 * box's centre is the layer's centre. That puts the layer where it belongs
 * without measuring it, and its zoom and turn pivot on its own centre.
 */
export function layerAnchorStyle(x: number, y: number, frame: Pick<CanvasFrame, 'width' | 'k'>): ViewStyle {
  const half = frame.width * 1.5;
  return {
    position: 'absolute',
    left: x * frame.k - half,
    top: y * frame.k - half,
    width: half * 2,
    height: half * 2,
    alignItems: 'center',
    justifyContent: 'center',
  };
}

/** Text wraps at this width (canvas units) before any zoom, like a story's margins. */
export const TEXT_WRAP = CANVAS_W - 120;

export const LayerContent = memo(function LayerContent({
  layer,
  k,
  music,
}: {
  layer: Layer;
  k: number;
  /** The story's song, for the music sticker. */
  music?: StoryMusic | null;
}) {
  if (layer.type === 'mention') {
    const px = layer.size * k;
    return (
      <View style={[styles.pill, { paddingHorizontal: px * 0.4, paddingVertical: px * 0.14, borderRadius: px * 0.3 }]}>
        <Text style={[styles.mentionText, { fontSize: px, lineHeight: px * 1.15 }]} numberOfLines={1}>
          {layer.text.toUpperCase()}
        </Text>
      </View>
    );
  }
  if (layer.type === 'music') {
    if (!music) return null;
    const px = layer.size * k;
    if (layer.style === 'mini') {
      return (
        <View style={[styles.pill, styles.row, { paddingHorizontal: px * 0.45, paddingVertical: px * 0.25, borderRadius: px, gap: px * 0.3, maxWidth: 900 * k }]}>
          <Icon.music size={px} color="#FF6B2B" weight="fill" />
          <Text style={[styles.musicTitle, { fontSize: px * 0.8 }]} numberOfLines={1}>
            {music.title} · <Text style={styles.musicArtist}>{music.artist}</Text>
          </Text>
        </View>
      );
    }
    return (
      <View style={[styles.pill, styles.row, { padding: px * 0.25, borderRadius: px * 0.35, gap: px * 0.35, width: px * 9 }]}>
        {music.artwork ? (
          <Image source={{ uri: music.artwork }} style={{ width: px * 1.8, height: px * 1.8, borderRadius: px * 0.2 }} cachePolicy="memory-disk" />
        ) : (
          <View style={[styles.artFallback, { width: px * 1.8, height: px * 1.8, borderRadius: px * 0.2 }]}>
            <Icon.music size={px} weight="fill" />
          </View>
        )}
        <View style={styles.flexShrink}>
          <Text style={[styles.musicTitle, { fontSize: px * 0.7 }]} numberOfLines={1}>{music.title}</Text>
          <Text style={[styles.musicArtist, { fontSize: px * 0.6 }]} numberOfLines={1}>{music.artist}</Text>
        </View>
      </View>
    );
  }
  if (layer.type === 'sticker') {
    if (layer.kind === 'emoji') {
      return <Text style={{ fontSize: layer.size * k, lineHeight: layer.size * k * 1.2 }}>{layer.text}</Text>;
    }
    return (
      <View style={[styles.pill, { paddingHorizontal: layer.size * k * 0.45, paddingVertical: layer.size * k * 0.15, borderRadius: layer.size * k * 0.3 }]}>
        <Text style={[styles.pillText, { fontSize: layer.size * k, lineHeight: layer.size * k * 1.15 }]}>{layer.text}</Text>
      </View>
    );
  }

  const { box, text } = textLayerStyles(layer, k);
  return (
    <View style={box}>
      <Text style={text}>{layer.text}</Text>
    </View>
  );
});

/** Box and text styles for a text layer at scale `k`; the editor's text input uses them too. */
export function textLayerStyles(layer: TextLayer, k: number): { box: ViewStyle; text: TextStyle } {
  const font = FONTS[layer.font] ?? FONTS.classic;
  const px = layer.size * k;
  let color = layer.color;
  let backgroundColor: string | undefined;
  if (layer.bg === 'solid') {
    backgroundColor = layer.color;
    color = contrastOn(layer.color);
  } else if (layer.bg === 'soft') {
    backgroundColor = contrastOn(layer.color) === '#000000' ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.7)';
  }
  const glow = font.glow && layer.bg === 'none';
  return {
    box: {
      maxWidth: TEXT_WRAP * k,
      backgroundColor,
      borderRadius: backgroundColor ? px * 0.28 : 0,
      paddingHorizontal: backgroundColor ? px * 0.3 : 0,
      paddingVertical: backgroundColor ? px * 0.1 : 0,
    },
    text: {
      color: glow ? '#FFFFFF' : color,
      fontSize: px,
      lineHeight: px * 1.22,
      fontFamily: font.family,
      fontWeight: font.weight,
      fontStyle: font.italic ? 'italic' : 'normal',
      textTransform: font.upper ? 'uppercase' : 'none',
      letterSpacing: font.letterSpacing ? font.letterSpacing * px : 0,
      textAlign: layer.align,
      ...(glow
        ? { textShadowColor: layer.color === '#FFFFFF' ? '#FF6B2B' : layer.color, textShadowRadius: px * 0.35, textShadowOffset: { width: 0, height: 0 } }
        : !backgroundColor
          ? { textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: px * 0.08, textShadowOffset: { width: 0, height: px * 0.02 } }
          : null),
    },
  };
}

export function placementTransform(p: { scale: number; rotation: number }) {
  return [{ rotate: `${p.rotation}rad` }, { scale: p.scale }];
}

/** A finished story, as viewers see it. */
export function StoryCanvas({
  layout,
  mediaUri,
  video,
  frame,
  style,
  viewRef,
  onLoad,
  onError,
}: {
  layout: StoryLayout;
  mediaUri: string | null;
  /** Set when the media is a video. */
  video?: VideoPlayback;
  frame: CanvasFrame;
  style?: StyleProp<ViewStyle>;
  /** The canvas view, for saving it as an image. */
  viewRef?: React.Ref<View>;
  onLoad?: () => void;
  onError?: () => void;
}) {
  const { photo } = layout;
  return (
    <View
      ref={viewRef}
      collapsable={false}
      style={[{ width: frame.width, height: frame.height }, styles.canvas, style]}
      pointerEvents="none"
    >
      {/* A video can't be blurred behind itself. */}
      <StoryBackgroundView bg={layout.bg} mediaUri={video ? null : mediaUri} />
      {photo && mediaUri && (
        <View style={[photoBoxStyle(photo, frame.k), { transform: placementTransform(photo) }]}>
          <PhotoContent uri={mediaUri} photo={photo} video={video} onLoad={onLoad} onError={onError} />
        </View>
      )}
      <StrokesView strokes={layout.strokes} frame={frame} />
      {layout.layers.map((layer) => (
        <View key={layer.id} style={layerAnchorStyle(layer.x, layer.y, frame)}>
          <View style={{ transform: placementTransform(layer) }}>
            <LayerContent layer={layer} k={frame.k} music={layout.music} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Where each @mention sits on the canvas, roughly, for tapping it in the
 * viewer. Text isn't measured, so the box is estimated from its length.
 */
export function mentionAt(layout: StoryLayout, x: number, y: number) {
  for (let i = layout.layers.length - 1; i >= 0; i--) {
    const l = layout.layers[i];
    if (l.type !== 'mention') continue;
    // Into the sticker's own frame: undo its move, turn and zoom.
    const dx = x - l.x;
    const dy = y - l.y;
    const cos = Math.cos(-l.rotation);
    const sin = Math.sin(-l.rotation);
    const lx = (dx * cos - dy * sin) / l.scale;
    const ly = (dx * sin + dy * cos) / l.scale;
    const halfW = (l.text.length * l.size * 0.62 + l.size * 0.8) / 2 + 20;
    const halfH = l.size * 0.75 + 20;
    if (Math.abs(lx) <= halfW && Math.abs(ly) <= halfH) return l;
  }
  return null;
}

const styles = StyleSheet.create({
  canvas: {
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  blurShade: {
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  photoInner: {
    flex: 1,
    isolation: 'isolate',
  },
  pill: {
    backgroundColor: '#FFFFFF',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flexShrink: {
    flexShrink: 1,
  },
  mentionText: {
    color: '#FF6B2B',
    fontWeight: '800',
  },
  musicTitle: {
    color: '#111111',
    fontWeight: '700',
  },
  musicArtist: {
    color: '#6B6B6B',
    fontWeight: '500',
  },
  artFallback: {
    backgroundColor: '#FF6B2B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    color: '#111111',
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
});
