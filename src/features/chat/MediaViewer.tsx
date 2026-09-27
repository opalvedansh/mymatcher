import React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { ChatMessage } from '@/api/types';
import { getVideo } from '@/utils/optionalModules';
import { sz } from '@/theme/scale';
import { openLink } from './LinkifiedText';
import { formatClock } from './format';

/** The display source for an attachment: this device's own file while it is being sent. */
export function mediaSource(message: ChatMessage) {
  const att = message.attachment;
  if (!att) return null;
  const uri = att.local_uri || att.url;
  return uri ? { uri, cacheKey: att.local_uri ? undefined : att.key } : null;
}

function VideoPlayer({ uri }: { uri: string }) {
  const video = getVideo()!;
  const player = video.useVideoPlayer(uri, (p) => {
    p.play();
  });
  return (
    <video.VideoView
      player={player}
      nativeControls
      contentFit="contain"
      allowsPictureInPicture={false}
      style={StyleSheet.absoluteFill}
    />
  );
}

/** Full-screen photo (pinch to zoom on iOS) or video player. */
export function MediaViewer({
  message,
  senderName,
  onClose,
  onReply,
  onForward,
}: {
  message: ChatMessage | null;
  senderName: string;
  onClose: () => void;
  onReply?: (message: ChatMessage) => void;
  onForward?: (message: ChatMessage) => void;
}) {
  const { width, height } = useWindowDimensions();
  const source = message ? mediaSource(message) : null;
  const isVideo = message?.kind === 'video';
  const remoteUrl = message?.attachment?.url ?? null;

  return (
    <Modal visible={!!message} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        {message && source && (
          isVideo ? (
            getVideo() ? (
              <VideoPlayer uri={source.uri} />
            ) : (
              <View style={styles.fallback}>
                <Ionicons name="videocam-outline" size={sz(42)} color="#BDBDBD" />
                <Text style={styles.fallbackText}>Update Matchr to play videos here.</Text>
                {remoteUrl && (
                  <Pressable onPress={() => openLink(remoteUrl)} style={styles.fallbackButton} accessibilityRole="button">
                    <Text style={styles.fallbackButtonText}>Open video</Text>
                  </Pressable>
                )}
              </View>
            )
          ) : (
            <ScrollView
              style={StyleSheet.absoluteFill}
              contentContainerStyle={{ width, height, justifyContent: 'center' }}
              maximumZoomScale={4}
              minimumZoomScale={1}
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              <Image source={source} style={{ width, height }} contentFit="contain" accessibilityLabel="Photo" />
            </ScrollView>
          )
        )}

        <SafeAreaView style={styles.top} edges={['top']} pointerEvents="box-none">
          <View style={styles.topRow}>
            <Pressable onPress={onClose} hitSlop={8} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={sz(26)} color="#FFF" />
            </Pressable>
            {message && (
              <View style={styles.titleBox}>
                <Text style={styles.title} numberOfLines={1}>{senderName}</Text>
                <Text style={styles.subtitle}>{formatClock(message.created_at)}</Text>
              </View>
            )}
            {message && onForward && !message.id.startsWith('temp-') && (
              <Pressable onPress={() => onForward(message)} hitSlop={8} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Forward">
                <Ionicons name="arrow-redo-outline" size={sz(22)} color="#FFF" />
              </Pressable>
            )}
            {remoteUrl && (
              <Pressable
                onPress={() => openLink(remoteUrl)}
                hitSlop={8}
                style={styles.iconButton}
                accessibilityRole="button"
                accessibilityLabel={Platform.OS === 'web' ? 'Open original' : 'Open to save or share'}
              >
                <Ionicons name={Platform.OS === 'ios' ? 'share-outline' : 'download-outline'} size={sz(22)} color="#FFF" />
              </Pressable>
            )}
          </View>
        </SafeAreaView>

        {message && (!!message.content || onReply) && (
          <SafeAreaView style={styles.bottom} edges={['bottom']} pointerEvents="box-none">
            {!!message.content && <Text style={styles.caption}>{message.content}</Text>}
            {onReply && !message.id.startsWith('temp-') && (
              <Pressable onPress={() => onReply(message)} style={styles.replyButton} accessibilityRole="button">
                <Ionicons name="arrow-undo-outline" size={sz(18)} color="#FFF" />
                <Text style={styles.replyText}>Reply</Text>
              </Pressable>
            )}
          </SafeAreaView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: sz(8), paddingVertical: sz(6), gap: sz(4) },
  iconButton: { width: sz(44), height: sz(44), borderRadius: sz(22), justifyContent: 'center', alignItems: 'center' },
  titleBox: { flex: 1, marginLeft: sz(4) },
  title: { color: '#FFF', fontSize: sz(16), fontWeight: '700' },
  subtitle: { color: '#BDBDBD', fontSize: sz(12), marginTop: 1 },
  bottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: sz(16), paddingTop: sz(12),
  },
  caption: { color: '#FFF', fontSize: sz(15), lineHeight: sz(21), marginBottom: sz(10) },
  replyButton: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: sz(6),
    paddingVertical: sz(8), paddingHorizontal: sz(12), borderRadius: sz(18), backgroundColor: 'rgba(255,255,255,0.12)',
    marginBottom: sz(10),
  },
  replyText: { color: '#FFF', fontSize: sz(14), fontWeight: '600' },
  fallback: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: sz(40), gap: sz(12) },
  fallbackText: { color: '#BDBDBD', fontSize: sz(15), textAlign: 'center' },
  fallbackButton: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: sz(12), paddingVertical: sz(10), paddingHorizontal: sz(20) },
  fallbackButtonText: { color: '#FFF', fontSize: sz(15), fontWeight: '600' },
});
