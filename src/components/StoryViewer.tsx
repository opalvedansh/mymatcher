import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  FlatList,
  ActivityIndicator,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { recordStoryView, getStoryViewers } from '@/api';
import { StoryCanvas, mentionAt } from '@/features/story/StoryCanvas';
import { MUSIC_CLIP_SECONDS, readLayout, useCanvasFrame, type StoryMusic } from '@/features/story/layout';
import { useStoryMusic } from '@/features/story/media';
import { Icon } from '@/features/story/icons';
import { CLOSE_FRIENDS_GREEN } from '@/features/story/StorySheets';
import { openSafetyMenu } from '@/components/safetyMenu';
import { showAlert } from '@/components/ActionSheet';
import { canSaveToCameraRoll, getMediaLibrary, getViewShot } from '@/utils/optionalModules';
import { sz } from '@/theme/scale';

type StoryItem = {
  id: string;
  /** Null for a text-only story. */
  media_url: string | null;
  /** What the editor placed over the photo; missing on stories posted before it. */
  layout?: unknown;
  media_type?: 'image' | 'video';
  duration_ms?: number | null;
  /** Shared to the author's Close Friends only. */
  close_friends?: boolean;
};

type StoryGroup = {
  id: string;
  name: string;
  avatar: string;
  isMe?: boolean;
  items: StoryItem[];
};

interface StoryViewerProps {
  visible: boolean;
  stories: StoryGroup[];
  /**
   * Read once, on mount. Callers remount the viewer (`key`) for every open so
   * the first frame already shows the right group.
   */
  initialGroupIndex?: number;
  onClose: () => void;
}

const STORY_DURATION = 5000; // 5 seconds per photo story
const MAX_VIDEO_MS = 60_000;

/** How long a story stays up: a video's length, a song's clip, or five seconds. */
function durationOf(item: StoryItem, music: StoryMusic | null | undefined) {
  if (item.media_type === 'video') return Math.min(item.duration_ms || STORY_DURATION, MAX_VIDEO_MS);
  return music ? MUSIC_CLIP_SECONDS * 1000 : STORY_DURATION;
}

/** Plays a story's song; keyed per story so each starts at the top of its clip. */
function StoryMusicPlayer({ music, playing }: { music: StoryMusic; playing: boolean }) {
  useStoryMusic(music, playing);
  return null;
}
/** Room under the story for the reply bar; the story itself is never cropped. */
const REPLY_BAR = sz(64);

/** Nearest group at or after `from` (stepping by `dir`) that has something to show. */
function findGroup(stories: StoryGroup[], from: number, dir: 1 | -1): number {
  for (let i = from; i >= 0 && i < stories.length; i += dir) {
    if (stories[i]?.items?.length) return i;
  }
  return -1;
}

export function StoryViewer({ visible, stories, initialGroupIndex = 0, onClose }: StoryViewerProps) {
  const { width, height } = useWindowDimensions();
  const frame = useCanvasFrame(REPLY_BAR);
  const router = useRouter();
  const canvasRef = useRef<View>(null);

  // Seeded from props rather than reset in an effect: an effect runs after the
  // first paint, which flashed the previously viewed group and recorded a view
  // on it before snapping to the tapped one.
  const [groupIndex, setGroupIndex] = useState(() => Math.max(0, findGroup(stories, Math.max(0, initialGroupIndex), 1)));
  const [itemIndex, setItemIndex] = useState(0);
  // The timer only runs once the photo is on screen; a slow load shouldn't eat
  // the five seconds.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [restartTick, setRestartTick] = useState(0);

  // Each reason to pause is tracked on its own so, say, closing the viewers
  // sheet doesn't resume a story the user had paused with the button.
  const [userPaused, setUserPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const [buffering, setBuffering] = useState(false);
  // A tapped @mention shows a "View profile" bubble and holds the story.
  const [mentionTip, setMentionTip] = useState<{ userId: string; name: string; x: number; y: number } | null>(null);
  // Sound is on by default, as on Instagram; this is for the whole session.
  const [muted, setMuted] = useState(false);

  const [replyText, setReplyText] = useState('');
  const [viewersList, setViewersList] = useState<any[] | null>(null);

  const progress = useSharedValue(0);

  const group = stories[groupIndex];
  const item = group?.items[itemIndex];
  const itemId = item?.id;
  const loaded = !!itemId && loadedId === itemId;
  const paused = userPaused || held || inputFocused || showViewers || !!mentionTip;
  const layout = useMemo(() => (item ? readLayout(item.layout, !!item.media_url) : null), [item]);
  const isVideo = item?.media_type === 'video';
  const duration = item ? durationOf(item, layout?.music) : STORY_DURATION;
  const hasSound = isVideo || !!layout?.music;

  // A new story starts unbuffered and with no bubble.
  useEffect(() => {
    setBuffering(false);
    setMentionTip(null);
  }, [itemId]);

  // A text-only story has nothing to load, so its timer starts straight away.
  useEffect(() => {
    if (item && !item.media_url) setLoadedId(item.id);
  }, [item]);

  // Empty the bar before the index changes: the next story's bar otherwise
  // renders one frame full, before the run effect below resets it.
  const resetBar = () => {
    cancelAnimation(progress);
    progress.value = 0;
  };

  const goToNext = () => {
    if (!group) return;
    resetBar();
    if (itemIndex < group.items.length - 1) {
      setItemIndex(itemIndex + 1);
      return;
    }
    const next = findGroup(stories, groupIndex + 1, 1);
    if (next === -1) {
      onClose();
      return;
    }
    setGroupIndex(next);
    setItemIndex(0);
  };

  const goToPrev = () => {
    resetBar();
    if (itemIndex > 0) {
      setItemIndex(itemIndex - 1);
      return;
    }
    const prev = findGroup(stories, groupIndex - 1, -1);
    if (prev === -1) {
      setRestartTick((t) => t + 1);
      return;
    }
    setGroupIndex(prev);
    setItemIndex(stories[prev].items.length - 1);
  };

  // The finish callback crosses from the UI thread, so it reaches the latest
  // render through refs instead of a stale closure.
  const itemIdRef = useRef(itemId);
  itemIdRef.current = itemId;
  const goToNextRef = useRef(goToNext);
  goToNextRef.current = goToNext;
  const onTimerDone = useCallback((finishedId: string) => {
    // A tap can land in the same frame the bar fills; don't skip two stories.
    if (finishedId === itemIdRef.current) goToNextRef.current();
  }, []);

  // Runs the bar on the UI thread. Pausing cancels it where it stands, and
  // resuming finishes only the time that was left.
  const runKey = `${itemId}:${restartTick}`;
  const runKeyRef = useRef<string | null>(null);
  const runStartedRef = useRef(false);
  useEffect(() => {
    // New story (or a restart of the first one): empty bar.
    if (runKeyRef.current !== runKey) {
      runKeyRef.current = runKey;
      runStartedRef.current = false;
      cancelAnimation(progress);
      progress.value = 0;
    }
    if (!visible || !loaded || paused || buffering || !itemId) return;
    // Writes reach the UI thread asynchronously, so a fresh run can't read
    // back the reset above; only a resume reads where the bar stopped.
    const from = runStartedRef.current ? progress.value : 0;
    runStartedRef.current = true;
    const id = itemId;
    progress.value = withTiming(
      1,
      { duration: Math.max(0, duration * (1 - from)), easing: Easing.linear },
      (finished) => {
        if (finished) runOnJS(onTimerDone)(id);
      },
    );
    return () => cancelAnimation(progress);
  }, [runKey, visible, loaded, paused, buffering, itemId, progress, onTimerDone, duration]);

  // Counted once the photo is actually showing, once per story per open.
  const viewedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!visible || !loaded || !itemId || group?.isMe || viewedRef.current.has(itemId)) return;
    viewedRef.current.add(itemId);
    recordStoryView(itemId).catch(console.error);
  }, [visible, loaded, itemId, group?.isMe]);

  // Warm the cache for what comes next so tapping forward doesn't wait on
  // the network.
  useEffect(() => {
    if (!visible || !group) return;
    // Photos only: a video streams as it plays.
    const photoUrl = (i?: StoryItem) => (i && i.media_type !== 'video' ? i.media_url : null);
    const urls = group.items.slice(itemIndex + 1, itemIndex + 3).map(photoUrl);
    const nextGroup = stories[findGroup(stories, groupIndex + 1, 1)];
    if (nextGroup) urls.push(photoUrl(nextGroup.items[0]));
    const toFetch = urls.filter((u): u is string => !!u);
    if (toFetch.length) Image.prefetch(toFetch, 'memory-disk').catch(() => {});
  }, [visible, group, groupIndex, itemIndex, stories]);

  const handlePress = (evt: any) => {
    const x = evt.nativeEvent.locationX;
    const y = evt.nativeEvent.locationY;
    if (mentionTip) {
      // Tapping anywhere else puts the bubble away and carries on.
      setMentionTip(null);
      return;
    }
    if (layout) {
      const hit = mentionAt(layout, (x - frame.left) / frame.k, (y - frame.top) / frame.k);
      if (hit) {
        setMentionTip({ userId: hit.userId, name: hit.text.replace(/^@/, ''), x, y });
        return;
      }
    }
    if (x < width / 2) {
      goToPrev();
    } else {
      goToNext();
    }
  };

  const handleSendReply = () => {
    if (replyText.trim()) {
      Alert.alert('Sent', `Your reply to ${group?.name} was sent!`);
      setReplyText('');
    }
  };

  const handleLike = () => {
    Alert.alert('Liked', 'You liked this story!');
  };

  const openMention = () => {
    if (!mentionTip) return;
    const id = mentionTip.userId;
    setMentionTip(null);
    onClose();
    router.push(`/profile/${id}`);
  };

  // Your own photo story can be saved; a video is saved from the editor.
  const canSave = !!group?.isMe && !isVideo && canSaveToCameraRoll();
  const saveStory = async () => {
    const library = getMediaLibrary();
    const shot = getViewShot();
    if (!library || !shot || !canvasRef.current) return;
    setUserPaused(true);
    try {
      const perm = await library.requestPermissionsAsync(true);
      if (!perm.granted) {
        showAlert('Allow saving photos', 'Turn on photo access for Matchr in Settings to save your story.');
        return;
      }
      const uri = await shot.captureRef(canvasRef, { format: 'jpg', quality: 0.95, width: 1080, height: 1920, result: 'tmpfile' });
      // SDK 57's saveToLibraryAsync is a stub that throws; Asset.create saves the file.
      await library.Asset.create(uri);
      showAlert('Saved', 'Your story is in your photo library.');
    } catch (err) {
      console.error('Failed to save story', err);
      showAlert('Couldn\'t save', 'Something went wrong while saving. Please try again.');
    }
  };

  const handleMore = () => {
    setUserPaused(true);
    showAlert('Your story', undefined, [
      { text: 'Save to camera roll', icon: 'download-outline', onPress: saveStory },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleShare = () => {
    Alert.alert('Share', 'Share functionality coming soon!');
  };

  const openSong = () => {
    const url = layout?.music?.url;
    if (url) Linking.openURL(url).catch(() => {});
  };

  const handleOpenViewers = async () => {
    if (!itemId) return;
    setViewersList(null);
    setShowViewers(true);
    try {
      setViewersList(await getStoryViewers(itemId));
    } catch (err) {
      console.error('Failed to get viewers:', err);
      setShowViewers(false);
      Alert.alert('Error', 'Could not load viewers.');
    }
  };

  const closeViewers = () => setShowViewers(false);

  // Stays mounted while hidden so the Modal can play its fade-out; returning
  // null here would unmount it mid-animation.
  if (!group || !item) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.container}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handlePress}
            onLongPress={() => setHeld(true)}
            onPressOut={() => setHeld(false)}
            delayLongPress={200}
          >
            <StoryCanvas
              // Remounted per story so onLoad fires even when two stories
              // share a URL, and the last photo never lingers under the next.
              key={item.id}
              layout={layout!}
              mediaUri={item.media_url}
              viewRef={canvasRef}
              video={
                isVideo
                  ? {
                      paused: !visible || paused,
                      muted: muted || !!layout?.videoMuted || !!layout?.music,
                      onBuffering: setBuffering,
                    }
                  : undefined
              }
              frame={frame}
              style={[styles.canvas, { top: frame.top, left: frame.left }]}
              onLoad={() => setLoadedId(item.id)}
              // A broken photo still counts down, or the viewer would hang.
              onError={() => {
                setFailedId(item.id);
                setLoadedId(item.id);
              }}
            />
            {!loaded && (
              <View style={styles.imageStatus} pointerEvents="none">
                <ActivityIndicator color="rgba(255,255,255,0.7)" />
              </View>
            )}
            {failedId === item.id && (
              <View style={styles.imageStatus} pointerEvents="none">
                <Icon.brokenImage size={sz(34)} color="rgba(255,255,255,0.5)" />
                <Text style={styles.failedText}>Couldn't load this story</Text>
              </View>
            )}
          </Pressable>

          {layout?.music && (
            <StoryMusicPlayer
              key={item.id}
              music={layout.music}
              playing={visible && loaded && !paused && !buffering && !muted}
            />
          )}

          {mentionTip && (
            <Pressable
              onPress={openMention}
              style={[
                styles.mentionTip,
                { top: Math.max(frame.top + sz(80), mentionTip.y - sz(64)), left: Math.min(Math.max(sz(12), mentionTip.x - sz(90)), width - sz(192)) },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`View ${mentionTip.name}'s profile`}
            >
              <Text style={styles.mentionTipText} numberOfLines={1}>{mentionTip.name}</Text>
              <Text style={styles.mentionTipAction}>View profile ›</Text>
            </Pressable>
          )}

          {/* Top Gradient for header readability */}
          <LinearGradient
            colors={['rgba(0,0,0,0.6)', 'transparent']}
            style={styles.topGradient}
            pointerEvents="none"
          />

          <SafeAreaView style={styles.overlay} pointerEvents="box-none">
            {/* Progress Bars */}
            <View style={styles.progressContainer}>
              {group.items.map((it, index) => (
                <View key={it.id} style={styles.progressBarBg}>
                  {index === itemIndex ? (
                    <ActiveProgress progress={progress} />
                  ) : index < itemIndex ? (
                    <View style={styles.progressBarFg} />
                  ) : null}
                </View>
              ))}
            </View>

            {/* Header */}
            <View style={styles.header}>
              <View style={styles.userInfo}>
                <Image source={{ uri: group.avatar }} style={styles.avatar} cachePolicy="memory-disk" />
                <View style={styles.userText}>
                  <View style={styles.nameRow}>
                    <Text style={styles.username} numberOfLines={1}>{group.name}</Text>
                    <Text style={styles.timeElapsed}>2 h</Text>
                    {item.close_friends && (
                      <View style={styles.cfBadge} accessibilityLabel="Close Friends">
                        <Icon.star size={sz(10)} />
                      </View>
                    )}
                  </View>
                  {layout?.music && (
                    <Pressable onPress={openSong} hitSlop={sz(6)} accessibilityRole="link" accessibilityLabel={`${layout.music.title} by ${layout.music.artist}, listen on Apple Music`}>
                      <Text style={styles.songLine} numberOfLines={1}>
                        ♪ {layout.music.title} · {layout.music.artist}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
              <View style={styles.headerRight}>
                {hasSound && (
                  <Pressable
                    onPress={() => setMuted((m) => !m)}
                    style={styles.headerIconBtn}
                    accessibilityLabel={muted ? 'Turn sound on' : 'Mute'}
                  >
                    {muted ? <Icon.soundOff size={sz(22)} /> : <Icon.soundOn size={sz(22)} />}
                  </Pressable>
                )}
                <Pressable
                  onPress={() => setUserPaused((p) => !p)}
                  style={styles.headerIconBtn}
                  accessibilityLabel={userPaused ? 'Play' : 'Pause'}
                >
                  {userPaused ? <Icon.play size={sz(20)} /> : <Icon.pause size={sz(20)} />}
                </Pressable>
                {!group.isMe && (
                  <Pressable
                    accessibilityLabel="Report or block"
                    style={styles.headerIconBtn}
                    onPress={() => {
                      // The menu has no dismiss callback, so leave it paused;
                      // the play button resumes.
                      setUserPaused(true);
                      // The story group id is the author's user id.
                      openSafetyMenu({
                        userId: group.id,
                        name: group.name,
                        target: { type: 'story', id: item.id },
                        onBlocked: onClose,
                      });
                    }}
                  >
                    <Icon.more size={sz(24)} />
                  </Pressable>
                )}
                <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.headerIconBtn}>
                  <Icon.close size={sz(24)} />
                </Pressable>
              </View>
            </View>

            <View style={{ flex: 1 }} pointerEvents="none" />

            {/* Bottom Gradient for input readability */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.7)']}
              style={styles.bottomGradient}
              pointerEvents="none"
            />

            {/* Bottom Bar */}
            <View style={styles.bottomBar}>
              {group.isMe ? (
                <View style={styles.viewersBarContainer}>
                  <Pressable style={styles.viewersBtn} onPress={handleOpenViewers}>
                    <Icon.viewers size={sz(24)} />
                    <Text style={styles.viewersText}>Viewers</Text>
                  </Pressable>
                  {canSave && (
                    <Pressable style={styles.actionBtn} onPress={handleMore} accessibilityLabel="More">
                      <Icon.more size={sz(28)} />
                    </Pressable>
                  )}
                </View>
              ) : (
                <>
                  <View style={styles.inputContainer}>
                    <TextInput
                      style={styles.input}
                      placeholder={`Reply to ${group.name}...`}
                      placeholderTextColor="#FFF"
                      value={replyText}
                      onChangeText={setReplyText}
                      onSubmitEditing={handleSendReply}
                      returnKeyType="send"
                      onFocus={() => setInputFocused(true)}
                      onBlur={() => setInputFocused(false)}
                    />
                  </View>

                  {!inputFocused && (
                    <View style={styles.actionButtons}>
                      <Pressable style={styles.actionBtn} onPress={handleLike}>
                        <Icon.like size={sz(28)} />
                      </Pressable>
                      <Pressable style={styles.actionBtn} onPress={handleShare}>
                        <Icon.send size={sz(26)} />
                      </Pressable>
                    </View>
                  )}
                </>
              )}
            </View>
          </SafeAreaView>

          {/* Viewers Bottom Sheet */}
          <Modal visible={showViewers} transparent animationType="slide" onRequestClose={closeViewers}>
            <View style={styles.viewersModalOverlay}>
              <Pressable style={styles.viewersBackdrop} onPress={closeViewers} accessibilityLabel="Close viewers" />
              {/* A plain View, not a Pressable, so the list below can scroll. */}
              <View style={[styles.viewersSheet, { maxHeight: height * 0.8 }]}>
                <View style={styles.viewersSheetHeader}>
                  <View style={styles.dragHandle} />
                  <Text style={styles.viewersSheetTitle}>Viewers</Text>
                </View>
                {viewersList === null ? (
                  <ActivityIndicator color="rgba(255,255,255,0.6)" style={{ marginTop: sz(20) }} />
                ) : (
                  <FlatList
                    data={viewersList}
                    keyExtractor={(viewer) => String(viewer.user_id)}
                    renderItem={({ item: viewer }) => (
                      <View style={styles.viewerRow}>
                        <Image source={{ uri: viewer.avatar }} style={styles.viewerAvatar} cachePolicy="memory-disk" />
                        <Text style={styles.viewerName}>{viewer.name}</Text>
                      </View>
                    )}
                    ListEmptyComponent={<Text style={styles.emptyViewersText}>No viewers yet.</Text>}
                    showsVerticalScrollIndicator={false}
                  />
                )}
              </View>
            </View>
          </Modal>

        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The current story's bar, driven on the UI thread. */
function ActiveProgress({ progress }: { progress: SharedValue<number> }) {
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));
  return <Animated.View style={[styles.progressBarFg, styles.progressBarActive, fill]} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  canvas: {
    position: 'absolute',
    borderRadius: sz(10),
  },
  imageStatus: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: sz(10),
  },
  failedText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: sz(14),
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: sz(120),
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: sz(150),
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  progressContainer: {
    flexDirection: 'row',
    paddingHorizontal: sz(10),
    paddingTop: sz(10),
    gap: sz(4),
  },
  progressBarBg: {
    flex: 1,
    height: sz(2.5),
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: sz(2),
    overflow: 'hidden',
  },
  progressBarFg: {
    width: '100%',
    height: '100%',
    backgroundColor: '#FFF',
  },
  // Scaled from the left edge so it grows like a width change, without the
  // per-frame layout a width animation costs.
  progressBarActive: {
    transformOrigin: 'left',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: sz(16),
    paddingTop: sz(12),
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: sz(8),
  },
  userText: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cfBadge: {
    marginLeft: sz(8),
    width: sz(18),
    height: sz(18),
    borderRadius: sz(9),
    backgroundColor: CLOSE_FRIENDS_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  songLine: {
    color: '#FFF',
    fontSize: sz(12),
    marginTop: sz(2),
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: sz(2),
  },
  mentionTip: {
    position: 'absolute',
    width: sz(180),
    paddingHorizontal: sz(14),
    paddingVertical: sz(10),
    borderRadius: sz(12),
    backgroundColor: 'rgba(20,20,20,0.92)',
  },
  mentionTipText: {
    color: '#FFF',
    fontSize: sz(14),
    fontWeight: '700',
  },
  mentionTipAction: {
    color: '#FF6B2B',
    fontSize: sz(13),
    fontWeight: '600',
    marginTop: sz(2),
  },
  avatar: {
    width: sz(34),
    height: sz(34),
    borderRadius: sz(17),
    marginRight: sz(10),
    borderWidth: 1,
    borderColor: '#FFF',
  },
  username: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: sz(14),
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: sz(2),
  },
  timeElapsed: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: sz(14),
    marginLeft: sz(8),
    fontWeight: '600',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(16),
  },
  headerIconBtn: {
    padding: sz(4),
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: sz(16),
    paddingBottom: Platform.OS === 'ios' ? sz(10) : sz(20),
    gap: sz(16),
  },
  inputContainer: {
    flex: 1,
    height: sz(48),
    borderRadius: sz(24),
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    paddingHorizontal: sz(16),
  },
  input: {
    color: '#FFF',
    fontSize: sz(15),
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(16),
  },
  actionBtn: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewersBarContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: sz(8),
  },
  viewersBtn: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewersText: {
    color: '#FFF',
    fontSize: sz(12),
    fontWeight: '600',
    marginTop: sz(2),
  },
  viewersModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  viewersBackdrop: {
    flex: 1,
  },
  viewersSheet: {
    backgroundColor: '#1E1E1E',
    borderTopLeftRadius: sz(16),
    borderTopRightRadius: sz(16),
    padding: sz(16),
    minHeight: sz(300),
  },
  viewersSheetHeader: {
    alignItems: 'center',
    marginBottom: sz(20),
  },
  dragHandle: {
    width: sz(40),
    height: sz(4),
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: sz(2),
    marginBottom: sz(16),
  },
  viewersSheetTitle: {
    color: '#FFF',
    fontSize: sz(16),
    fontWeight: 'bold',
  },
  emptyViewersText: {
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginTop: sz(20),
  },
  viewerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: sz(16),
  },
  viewerAvatar: {
    width: sz(44),
    height: sz(44),
    borderRadius: sz(22),
    marginRight: sz(12),
  },
  viewerName: {
    color: '#FFF',
    fontSize: sz(16),
    fontWeight: '500',
  }
});
