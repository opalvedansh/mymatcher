import { AntDesign, Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import {
  AccessibilityInfo,
  Animated,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { getFeedStories, getPostFeed, uploadImage, uploadStory } from '@/api';
import { syncLike } from '@/utils/likeSync';
import { StoryViewer } from '@/components/StoryViewer';
import CommentsSheet from '@/components/CommentsSheet';
import { showAlert } from '@/components/ActionSheet';
import { openSafetyMenu } from '@/components/safetyMenu';
import { useAuth } from '@/contexts/AuthContext';
import { sharePost as sharePostToOS } from '@/utils/postShare';
import type { Post } from '@/api/types';
import { sz, tabBarClearance } from '@/theme/scale';
import { tapFeedback } from '@/utils/optionalModules';

const ACCENT = '#FF6B2B';
const PAGE_SIZE = 20;
// Coming back to the tab after this long refetches quietly in the background.
const STALE_MS = 60_000;
// tabBarClearance already adds Android's bottom inset to the list padding, so
// only iOS keeps the bottom edge (as the old react-native SafeAreaView did).
const SAFE_EDGES: Edge[] | undefined = Platform.OS === 'android' ? ['top', 'left', 'right'] : undefined;

type FetchMode = 'initial' | 'refresh' | 'silent' | 'merge' | 'more';

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// Memoised because the feed re-renders on every like, refresh and pagination
// tick; without this each one re-renders every mounted card, photos included.
// All props are referentially stable — the callbacks are useCallback'd in the
// parent and `post` is replaced only when that row's data actually changes.
const HomePostCard = memo(function HomePostCard({
  post,
  isOwnPost,
  reduceMotion,
  onToggleLike,
  onAuthorBlocked,
  onOpenComments,
  onShared,
}: {
  post: Post;
  isOwnPost: boolean;
  reduceMotion: boolean;
  onToggleLike: (post: Post) => void;
  onAuthorBlocked: (userId: string) => void;
  onOpenComments: (post: Post) => void;
  onShared: (postId: string, sharesCount: number) => void;
}) {
  const heartScale = useRef(new Animated.Value(1)).current;
  const liked = !!post.liked_by_me;

  const toggleLike = () => {
    onToggleLike(post);
    tapFeedback();
    if (!reduceMotion) {
      Animated.sequence([
        Animated.spring(heartScale, { toValue: 1.3, useNativeDriver: Platform.OS !== 'web', speed: 40 }),
        Animated.spring(heartScale, { toValue: 1, useNativeDriver: Platform.OS !== 'web', speed: 40 }),
      ]).start();
    }
  };

  const sharePost = async () => {
    const count = await sharePostToOS(post);
    if (count !== null) onShared(post.id, count);
  };

  const authorName = post.author_name || 'Creator';
  const category = post.author_categories?.[0];

  return (
    <View style={styles.postBlock}>
      <View style={styles.postContainer}>
        <Image
          source={{ uri: post.image_url }}
          style={styles.postImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={150}
          recyclingKey={post.id}
        />

        {/* Dark fade behind the header so it reads over any photo */}
        <LinearGradient
          colors={['rgba(0,0,0,0.72)', 'rgba(0,0,0,0.28)', 'transparent']}
          style={styles.postHeaderShadow}
          pointerEvents="none"
        />

        <View style={styles.postHeader}>
          {post.author_avatar ? (
            <Image
              source={{ uri: post.author_avatar }}
              style={styles.postBrandLogo}
              cachePolicy="memory-disk"
              transition={150}
              recyclingKey={post.user_id}
            />
          ) : (
            <View style={[styles.postBrandLogo, styles.avatarFallback]}>
              <Text style={styles.avatarFallbackText}>{authorName.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.postBrandInfo}>
            <View style={styles.postBrandNameRow}>
              <Text style={styles.postBrandName} numberOfLines={1}>{authorName}</Text>
              {post.author_verified && (
                <MaterialIcons name="verified" size={sz(16)} color={ACCENT} style={{ marginLeft: sz(4) }} accessibilityLabel="Verified" />
              )}
            </View>
            <Text style={styles.postCategory} numberOfLines={1}>
              {category ? `${category}, ${timeAgo(post.created_at)}` : timeAgo(post.created_at)}
            </Text>
          </View>
          {!isOwnPost && (
            <Pressable
              accessibilityLabel="Report or block"
              hitSlop={10}
              style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
              onPress={() =>
                openSafetyMenu({
                  userId: post.user_id,
                  name: authorName,
                  target: { type: 'post', id: post.id },
                  onBlocked: () => onAuthorBlocked(post.user_id),
                })
              }
            >
              <Ionicons name="ellipsis-horizontal" size={sz(20)} color="#FFF" />
            </Pressable>
          )}
        </View>

        {/* Frosted bar; blur fades in from the top of the zone */}
        <View style={styles.glassContainer}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.05)']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.statsContent}>
            <Pressable
              onPress={toggleLike}
              accessibilityRole="button"
              accessibilityLabel={liked ? 'Unlike' : 'Like'}
              accessibilityState={{ selected: liked }}
              hitSlop={8}
              style={({ pressed }) => [styles.postStat, pressed && styles.pressed]}
            >
              <Animated.View style={{ transform: [{ scale: heartScale }] }}>
                <Ionicons name={liked ? 'heart' : 'heart-outline'} size={sz(24)} color={liked ? '#FF3B30' : '#FFF'} />
              </Animated.View>
              {post.likes_count > 0 && (
                <Text style={styles.postStatText}>{fmtCount(post.likes_count)}</Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => onOpenComments(post)}
              accessibilityRole="button"
              accessibilityLabel={`Comments, ${post.comments_count ?? 0}`}
              hitSlop={8}
              style={({ pressed }) => [styles.postStat, pressed && styles.pressed]}
            >
              <Ionicons name="chatbubble-outline" size={sz(23)} color="#FFF" />
              {!!post.comments_count && (
                <Text style={styles.postStatText}>{fmtCount(post.comments_count)}</Text>
              )}
            </Pressable>
            <Pressable
              onPress={sharePost}
              accessibilityRole="button"
              accessibilityLabel="Share"
              hitSlop={8}
              style={({ pressed }) => [styles.postStat, pressed && styles.pressed]}
            >
              <Ionicons name="paper-plane-outline" size={sz(24)} color="#FFF" />
              {!!post.shares_count && (
                <Text style={styles.postStatText}>{fmtCount(post.shares_count)}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>

      {!!post.caption && (
        <Text style={styles.caption} numberOfLines={2}>
          <Text style={styles.captionAuthor}>{authorName} </Text>
          {post.caption}
        </Text>
      )}
    </View>
  );
});

// Memoised so a like or a feed page landing doesn't re-render every avatar in
// the stories row; `onPress` is stable until the stories themselves change.
const StoryBubble = memo(function StoryBubble({
  item,
  index,
  onPress,
}: {
  item: any;
  index: number;
  onPress: (item: any, index: number) => void;
}) {
  const hasStory = !!item.items?.length;
  const avatar = item.avatar ? (
    <Image
      source={{ uri: item.avatar }}
      style={styles.storyAvatar}
      cachePolicy="memory-disk"
      transition={150}
      recyclingKey={item.id}
    />
  ) : (
    <View style={[styles.storyAvatar, styles.avatarFallback]}>
      <Ionicons name="person" size={sz(26)} color="#777" />
    </View>
  );

  return (
    <Pressable
      style={({ pressed }) => [styles.storyContainer, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={item.isMe ? 'Your story, create' : `${item.name}'s story`}
      onPress={() => onPress(item, index)}
    >
      {hasStory ? (
        <LinearGradient
          colors={[ACCENT, '#FF9A3D']}
          style={styles.storyRing}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.storyAvatarContainer}>{avatar}</View>
        </LinearGradient>
      ) : (
        <View style={[styles.storyRing, styles.storyRingEmpty]}>
          <View style={styles.storyAvatarContainer}>{avatar}</View>
        </View>
      )}
      {item.isMe && (
        <View style={styles.addStoryBadge} pointerEvents="none">
          <AntDesign name="plus" size={sz(12)} color="#111" />
        </View>
      )}
      <Text style={[styles.storyName, item.isMe && styles.storyNameMe]} numberOfLines={1}>
        {item.isMe ? 'Your story' : item.name}
      </Text>
    </Pressable>
  );
});

const storyKeyExtractor = (item: any) => item.id;

function PostSkeleton() {
  return (
    <View style={styles.postBlock}>
      <View style={[styles.postContainer, { backgroundColor: '#1A1A1A' }]}>
        <View style={styles.postHeader}>
          <View style={[styles.postBrandLogo, { backgroundColor: '#262626', borderWidth: 0 }]} />
          <View style={styles.postBrandInfo}>
            <View style={[styles.skeletonLine, { width: sz(120) }]} />
            <View style={[styles.skeletonLine, { width: sz(80), marginTop: sz(6) }]} />
          </View>
        </View>
      </View>
    </View>
  );
}

export default function InfluencerHomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [stories, setStories] = useState<any[]>([]);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);
  // Bumped on every open so the viewer mounts fresh on the tapped group.
  const [viewerKey, setViewerKey] = useState(0);

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [commentsFor, setCommentsFor] = useState<Post | null>(null);
  // Ranked-feed cursor. Null means "start over", which also rebuilds ranking.
  const cursorRef = useRef<string | null>(null);
  // Bumped by every start-over load. A response from an older generation
  // (a page that was in flight when the user pulled to refresh) is dropped.
  const genRef = useRef(0);
  const resetInFlightRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const refreshOnFocusRef = useRef(false);
  const postsLenRef = useRef(0);
  postsLenRef.current = posts.length;
  // Latest like request per post; only that one may roll the heart back.

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const fetchStories = useCallback(async (force = false) => {
    try {
      const res = await getFeedStories(force) as any;
      setStories(res.data || res);
    } catch (e) {
      console.log('Failed to fetch stories', e);
    }
  }, []);

  // initial: first load, skeleton and error state. refresh: pull-to-refresh.
  // silent: background start-over with no spinner. merge: background update of
  // rows already on screen, for when the user has paged deep and replacing the
  // list would yank it out from under them. more: next page.
  const fetchPosts = useCallback(async (mode: FetchMode) => {
    // The feed is ranked, so paging is by cursor, not offset: scores shift as
    // posts arrive and an offset would repeat and skip rows. Starting over
    // clears the cursor, which is also what rebuilds the ranking server-side.
    const isMore = mode === 'more';
    const cursor = isMore ? cursorRef.current : null;
    if (isMore && (!cursor || resetInFlightRef.current || loadingMoreRef.current)) return;
    const startsOver = mode === 'initial' || mode === 'refresh' || mode === 'silent';
    const gen = startsOver ? ++genRef.current : genRef.current;
    if (startsOver) resetInFlightRef.current = true;
    if (mode === 'refresh') setRefreshing(true);
    if (isMore) {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    try {
      const res = await getPostFeed(PAGE_SIZE, cursor);
      if (gen !== genRef.current) return;
      const page: Post[] = res.posts || [];
      if (mode === 'merge') {
        const fresh = new Map(page.map(p => [p.id, p]));
        setPosts(prev => prev.map(p => fresh.get(p.id) ?? p));
      } else {
        cursorRef.current = res.next_cursor ?? null;
        setPosts(prev => {
          if (!isMore) return page;
          const seen = new Set(prev.map(p => p.id));
          return [...prev, ...page.filter(p => !seen.has(p.id))];
        });
        setHasMore(Boolean(res.next_cursor));
      }
      if (!isMore) lastLoadedAtRef.current = Date.now();
      setError(false);
    } catch (e) {
      console.log('Failed to fetch posts', e);
      if (gen !== genRef.current) return;
      // Only an empty screen gets the error state; a failed refresh keeps the
      // feed that is already loaded.
      if (mode === 'initial') setError(true);
      else if (mode === 'refresh') showAlert("Couldn't refresh", 'Check your connection and try again.');
    } finally {
      if (isMore) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      } else if (startsOver && gen === genRef.current) {
        resetInFlightRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchStories();
    fetchPosts('initial');
  }, [fetchStories, fetchPosts]);

  // Returning to the tab: refetch quietly if the feed is stale, or always
  // after the create-post screen so a new post shows up. No skeleton, and the
  // list keeps its scroll position.
  useFocusEffect(
    useCallback(() => {
      if (!lastLoadedAtRef.current) return; // first focus: initial load is running
      const afterCreate = refreshOnFocusRef.current;
      refreshOnFocusRef.current = false;
      if (!afterCreate && Date.now() - lastLoadedAtRef.current < STALE_MS) return;
      fetchStories();
      fetchPosts(afterCreate || postsLenRef.current <= PAGE_SIZE ? 'silent' : 'merge');
    }, [fetchStories, fetchPosts]),
  );

  const refresh = () => {
    // The user explicitly asked for fresh data, so skip the stories cache.
    fetchStories(true);
    fetchPosts('refresh');
  };

  const retry = () => {
    setLoading(true);
    setError(false);
    fetchPosts('initial');
  };

  const goCreatePost = useCallback(() => {
    refreshOnFocusRef.current = true;
    router.push('/create-post');
  }, [router]);

  // Stable identities: these are props of the memoised row, so recreating them
  // each render would defeat the memo and re-render the whole feed on any
  // state change. They use the updater form and capture nothing.
  const setLiked = useCallback((postId: string, liked: boolean, count: number) => {
    setPosts(prev => prev.map(p => (p.id === postId ? { ...p, liked_by_me: liked, likes_count: count } : p)));
  }, []);

  // The heart flips on every tap; syncLike sends them to the server in order.
  const handleToggleLike = useCallback((post: Post) => {
    const wasLiked = !!post.liked_by_me;
    const nextLiked = !wasLiked;
    setLiked(post.id, nextLiked, Math.max(0, post.likes_count + (nextLiked ? 1 : -1)));
    // On failure, put back whatever the server holds; the count follows from this tap's snapshot.
    syncLike(post.id, wasLiked, nextLiked, (liked) =>
      setLiked(post.id, liked, Math.max(0, post.likes_count + (liked ? 1 : 0) - (wasLiked ? 1 : 0))));
  }, [setLiked]);

  const handleAuthorBlocked = useCallback((authorId: string) => {
    setPosts(prev => prev.filter(p => p.user_id !== authorId));
  }, []);

  const handleOpenComments = useCallback((post: Post) => setCommentsFor(post), []);

  const handleShared = useCallback((postId: string, sharesCount: number) => {
    setPosts(prev => prev.map(p => (p.id === postId ? { ...p, shares_count: sharesCount } : p)));
  }, []);

  const handleCommentCount = useCallback((postId: string, delta: number) => {
    setPosts(prev =>
      prev.map(p =>
        p.id === postId ? { ...p, comments_count: Math.max((p.comments_count ?? 0) + delta, 0) } : p
      )
    );
  }, []);

  const openViewer = useCallback((groupIndex: number) => {
    setSelectedGroupIndex(groupIndex);
    setViewerKey(k => k + 1);
    setViewerVisible(true);
  }, []);

  const handleAddStory = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      try {
        // Uploads the file itself; base64 made the picker hand a multi-MB
        // string across the bridge and froze the JS thread.
        await uploadStory(await uploadImage(result.assets[0].uri));
        fetchStories();
      } catch (err) {
        console.error('Failed to upload story', err);
        showAlert('Story not posted', 'Something went wrong while uploading. Please try again.');
      }
    }
  }, [fetchStories]);

  const handleStoryPress = useCallback((item: any, index: number) => {
    if (!item.isMe) {
      openViewer(index);
      return;
    }
    const hasStory = !!item.items?.length;
    showAlert('Create', undefined, [
      ...(hasStory
        ? [{
            text: 'View your story',
            icon: 'play-circle-outline' as const,
            onPress: () => openViewer(index),
          }]
        : []),
      { text: 'Add to story', icon: 'add-circle-outline', onPress: handleAddStory },
      { text: 'Create post', icon: 'images-outline', onPress: goCreatePost },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [openViewer, handleAddStory, goCreatePost]);

  const renderStory = useCallback(
    ({ item, index }: { item: any; index: number }) => (
      <StoryBubble item={item} index={index} onPress={handleStoryPress} />
    ),
    [handleStoryPress],
  );

  const renderPost = useCallback(
    ({ item }: { item: Post }) => (
      <HomePostCard
        post={item}
        isOwnPost={item.user_id === user?.id}
        reduceMotion={reduceMotion}
        onToggleLike={handleToggleLike}
        onAuthorBlocked={handleAuthorBlocked}
        onOpenComments={handleOpenComments}
        onShared={handleShared}
      />
    ),
    [user?.id, reduceMotion, handleToggleLike, handleAuthorBlocked, handleOpenComments, handleShared],
  );

  const keyExtractor = useCallback((item: Post) => item.id, []);

  // Passed as an element, not a component, so the stories row isn't remounted
  // (and scrolled back to the start) every time the feed re-renders. Memoised
  // so a like or a new page doesn't re-render it at all.
  const listHeader = useMemo(() => (
    <View style={styles.header}>
      <FlatList
        data={stories}
        renderItem={renderStory}
        keyExtractor={storyKeyExtractor}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.storiesContent}
      />
    </View>
  ), [stories, renderStory]);

  const listEmpty = loading ? (
    // A plain View, not a fragment: the list clones this element with onLayout.
    <View>
      <PostSkeleton />
      <PostSkeleton />
    </View>
  ) : error ? (
    <View style={styles.emptyState}>
      <Ionicons name="cloud-offline-outline" size={sz(36)} color="#777" />
      <Text style={styles.emptyTitle}>Couldn't load the feed</Text>
      <Text style={styles.emptyBody}>Check your connection and try again.</Text>
      <Pressable onPress={retry} accessibilityRole="button" style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
        <Text style={styles.secondaryButtonText}>Try again</Text>
      </Pressable>
    </View>
  ) : (
    <View style={styles.emptyState}>
      <Ionicons name="images-outline" size={sz(36)} color="#777" />
      <Text style={styles.emptyTitle}>No posts yet</Text>
      <Text style={styles.emptyBody}>Posts from creators and brands will show up here.</Text>
      <Pressable
        onPress={goCreatePost}
        accessibilityRole="button"
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
      >
        <Text style={styles.secondaryButtonText}>Create post</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={SAFE_EDGES}>
        <FlatList
          data={loading || error ? [] : posts}
          renderItem={renderPost}
          keyExtractor={keyExtractor}
          // Feed rows are near-full-screen photos, so the defaults (10 initial,
          // window of 21 screens) mount far more than can ever be visible.
          initialNumToRender={3}
          maxToRenderPerBatch={3}
          windowSize={5}
          removeClippedSubviews
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          ListFooterComponent={loadingMore ? <PostSkeleton /> : null}
          contentContainerStyle={styles.feedContent}
          showsVerticalScrollIndicator={false}
          refreshing={refreshing}
          onRefresh={refresh}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (!loading && !loadingMore && hasMore && posts.length > 0) fetchPosts('more');
          }}
        />
      </SafeAreaView>

      <CommentsSheet
        visible={!!commentsFor}
        postId={commentsFor?.id ?? null}
        postAuthorId={commentsFor?.user_id ?? null}
        currentUserId={user?.id ?? null}
        onCountChange={handleCommentCount}
        onViewProfile={(userId) => {
          setCommentsFor(null);
          router.push(`/profile/${userId}`);
        }}
        onClose={() => setCommentsFor(null)}
      />

      {/* Stays mounted after closing so the fade-out plays; the key gives each
          open a fresh viewer that starts on the tapped group. */}
      <StoryViewer
        key={viewerKey}
        visible={viewerVisible}
        stories={stories}
        initialGroupIndex={selectedGroupIndex}
        onClose={() => setViewerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    paddingVertical: sz(16),
  },
  storiesContent: {
    paddingHorizontal: sz(16),
    gap: sz(16),
  },
  storyContainer: {
    alignItems: 'center',
    width: sz(76),
  },
  storyRing: {
    width: sz(76),
    height: sz(76),
    borderRadius: sz(38),
    padding: sz(3),
    justifyContent: 'center',
    alignItems: 'center',
  },
  storyRingEmpty: {
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  storyAvatarContainer: {
    width: '100%',
    height: '100%',
    backgroundColor: '#121212',
    borderRadius: sz(35),
    padding: sz(3),
    justifyContent: 'center',
    alignItems: 'center',
  },
  storyAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: sz(35),
  },
  avatarFallback: {
    backgroundColor: '#262626',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarFallbackText: {
    color: '#FFF',
    fontSize: sz(17),
    fontWeight: '700',
  },
  addStoryBadge: {
    position: 'absolute',
    top: sz(54),
    right: 0,
    backgroundColor: '#FFF',
    width: sz(22),
    height: sz(22),
    borderRadius: sz(11),
    borderWidth: 2,
    borderColor: '#121212',
    justifyContent: 'center',
    alignItems: 'center',
  },
  storyName: {
    color: '#E0E0E0',
    fontSize: sz(12),
    marginTop: sz(8),
  },
  storyNameMe: {
    color: '#9A9A9A',
  },
  feedContent: {
    paddingHorizontal: sz(16),
    paddingBottom: tabBarClearance(100), // clears the floating tab bar
  },
  postBlock: {
    width: '100%',
    maxWidth: sz(560),
    alignSelf: 'center',
    marginBottom: sz(24),
  },
  postContainer: {
    width: '100%',
    aspectRatio: 0.85,
    backgroundColor: '#222',
    borderRadius: sz(32),
    overflow: 'hidden',
  },
  postImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  postHeaderShadow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: sz(130),
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: sz(20),
  },
  postBrandLogo: {
    width: sz(44),
    height: sz(44),
    borderRadius: sz(22),
    borderWidth: 2,
    borderColor: '#FFF',
  },
  postBrandInfo: {
    flex: 1,
    marginLeft: sz(12),
  },
  postBrandNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  postBrandName: {
    color: '#FFF',
    fontSize: sz(16),
    fontWeight: '700',
    flexShrink: 1,
  },
  postCategory: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: sz(12),
    marginTop: sz(2),
  },
  moreButton: {
    width: sz(36),
    height: sz(36),
    borderRadius: sz(18),
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: sz(8),
  },
  glassContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: sz(110),
    justifyContent: 'flex-end',
    overflow: 'hidden',
    ...Platform.select({
      web: {
        // The blur covers the whole zone; the mask fades it in from the top.
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        maskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.4) 35%, black 65%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.4) 35%, black 65%)',
      } as any,
      default: {},
    }),
  },
  statsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sz(48),
    paddingBottom: sz(18),
    paddingTop: sz(10),
  },
  postStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sz(8),
    paddingVertical: sz(4),
  },
  postStatText: {
    color: '#FFF',
    fontSize: sz(16),
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  caption: {
    color: '#CFCFCF',
    fontSize: sz(14),
    lineHeight: sz(20),
    marginTop: sz(10),
    paddingHorizontal: sz(6),
  },
  captionAuthor: {
    color: '#FFF',
    fontWeight: '600',
  },
  skeletonLine: {
    height: sz(10),
    borderRadius: sz(5),
    backgroundColor: '#262626',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: sz(64),
    paddingHorizontal: sz(32),
  },
  emptyTitle: {
    color: '#FFF',
    fontSize: sz(17),
    fontWeight: '600',
    marginTop: sz(14),
  },
  emptyBody: {
    color: '#9A9A9A',
    fontSize: sz(13),
    lineHeight: sz(19),
    textAlign: 'center',
    marginTop: sz(6),
    marginBottom: sz(20),
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: sz(12),
    paddingVertical: sz(11),
    paddingHorizontal: sz(22),
  },
  secondaryButtonText: {
    color: '#FFF',
    fontSize: sz(15),
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.75,
    transform: [{ scale: 0.97 }],
  },
});
