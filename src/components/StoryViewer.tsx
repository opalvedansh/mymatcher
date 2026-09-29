import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  useWindowDimensions,
} from 'react-native';
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
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { recordStoryView, getStoryViewers } from '@/api';
import { openSafetyMenu } from '@/components/safetyMenu';
import { sz } from '@/theme/scale';

type StoryItem = {
  id: string;
  media_url: string;
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

const STORY_DURATION = 5000; // 5 seconds per story

/** Nearest group at or after `from` (stepping by `dir`) that has something to show. */
function findGroup(stories: StoryGroup[], from: number, dir: 1 | -1): number {
  for (let i = from; i >= 0 && i < stories.length; i += dir) {
    if (stories[i]?.items?.length) return i;
  }
  return -1;
}

export function StoryViewer({ visible, stories, initialGroupIndex = 0, onClose }: StoryViewerProps) {
  const { width, height } = useWindowDimensions();

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

  const [replyText, setReplyText] = useState('');
  const [viewersList, setViewersList] = useState<any[] | null>(null);

  const progress = useSharedValue(0);

  const group = stories[groupIndex];
  const item = group?.items[itemIndex];
  const itemId = item?.id;
  const loaded = !!itemId && loadedId === itemId;
  const paused = userPaused || held || inputFocused || showViewers;

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
    if (!visible || !loaded || paused || !itemId) return;
    // Writes reach the UI thread asynchronously, so a fresh run can't read
    // back the reset above; only a resume reads where the bar stopped.
    const from = runStartedRef.current ? progress.value : 0;
    runStartedRef.current = true;
    const id = itemId;
    progress.value = withTiming(
      1,
      { duration: Math.max(0, STORY_DURATION * (1 - from)), easing: Easing.linear },
      (finished) => {
        if (finished) runOnJS(onTimerDone)(id);
      },
    );
    return () => cancelAnimation(progress);
  }, [runKey, visible, loaded, paused, itemId, progress, onTimerDone]);

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
    const urls = group.items.slice(itemIndex + 1, itemIndex + 3).map((i) => i.media_url);
    const nextGroup = stories[findGroup(stories, groupIndex + 1, 1)];
    if (nextGroup) urls.push(nextGroup.items[0].media_url);
    if (urls.length) Image.prefetch(urls, 'memory-disk').catch(() => {});
  }, [visible, group, groupIndex, itemIndex, stories]);

  const handlePress = (evt: any) => {
    const x = evt.nativeEvent.locationX;
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

  const handleShare = () => {
    Alert.alert('Share', 'Share functionality coming soon!');
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
            <Image
              // Remounted per story so onLoad fires even when two stories
              // share a URL, and the last photo never lingers under the next.
              key={item.id}
              recyclingKey={item.id}
              source={{ uri: item.media_url }}
              style={styles.image}
              contentFit="cover"
              cachePolicy="memory-disk"
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
                <Ionicons name="image-outline" size={sz(34)} color="rgba(255,255,255,0.5)" />
                <Text style={styles.failedText}>Couldn't load this story</Text>
              </View>
            )}
          </Pressable>

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
                <Text style={styles.username}>{group.name}</Text>
                <Text style={styles.timeElapsed}>2 h</Text>
              </View>
              <View style={styles.headerRight}>
                <Pressable
                  onPress={() => setUserPaused((p) => !p)}
                  style={styles.headerIconBtn}
                  accessibilityLabel={userPaused ? 'Play' : 'Pause'}
                >
                  <Ionicons name={userPaused ? 'play' : 'pause'} size={sz(22)} color="#FFF" />
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
                    <Ionicons name="ellipsis-horizontal" size={sz(24)} color="#FFF" />
                  </Pressable>
                )}
                <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.headerIconBtn}>
                  <Ionicons name="close" size={sz(26)} color="#FFF" />
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
                    <Ionicons name="eye-outline" size={sz(24)} color="#FFF" />
                    <Text style={styles.viewersText}>Viewers</Text>
                  </Pressable>
                  <Pressable style={styles.actionBtn} onPress={handleShare}>
                    <Ionicons name="ellipsis-horizontal" size={sz(28)} color="#FFF" />
                  </Pressable>
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
                        <Ionicons name="heart-outline" size={sz(30)} color="#FFF" />
                      </Pressable>
                      <Pressable style={styles.actionBtn} onPress={handleShare}>
                        <Ionicons name="paper-plane-outline" size={sz(28)} color="#FFF" />
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
  image: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
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
