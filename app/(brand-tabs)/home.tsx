import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Animated,
  AccessibilityInfo,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { AntDesign, Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { getFeedStories, getPostFeed, uploadImage, uploadStory } from '@/api';
import { syncLike } from '@/utils/likeSync';
import { StoryViewer } from '@/components/StoryViewer';
import CommentsSheet from '@/components/CommentsSheet';
import { sharePost as sharePostToOS } from '@/utils/postShare';
import { Avatar } from '@/components/ChatAvatar';
import { showAlert } from '@/components/ActionSheet';
import { openSafetyMenu } from '@/components/safetyMenu';
import { useAuth } from '@/contexts/AuthContext';
import type { Post } from '@/api/types';
import { sz, tabBarClearance } from '@/theme/scale';
import { tapFeedback } from '@/utils/optionalModules';

const ACCENT = '#FF6B2B';
const PAGE_SIZE = 20;
// Coming back to the tab after this long refetches quietly in the background.
const STALE_MS = 60_000;
// The tab bar covers the bottom safe area and tabBarClearance already adds
// it to the list padding, so the bottom edge is left out here.
const SAFE_EDGES: Edge[] = ['top', 'left', 'right'];

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

// ─── Feed Post Card ───────────────────────────────────────────────
// Memoised because the feed re-renders on every like, refresh and pagination
// tick; without this each one re-renders every mounted card, photos included.
// All props are referentially stable — the callbacks are useCallback'd in the
// parent and `post` is replaced only when that row's data actually changes.
const FeedPostCard = memo(function FeedPostCard({
  post,
  width,
  isOwnPost,
  reduceMotion,
  onToggleLike,
  onAuthorBlocked,
  onOpenComments,
  onShared,
}: {
  post: Post;
  width: number;
  isOwnPost: boolean;
  reduceMotion: boolean;
  onToggleLike: (post: Post) => void;
  onAuthorBlocked: (userId: string) => void;
  onOpenComments: (post: Post) => void;
  onShared: (postId: string, sharesCount: number) => void;
}) {
  const heartScale = useRef(new Animated.Value(1)).current;
  const liked = !!post.liked_by_me;
  const authorName = post.author_name || 'Creator';
  const category = post.author_categories?.[0];

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

  return (
    <View style={[fc.card, { width: Math.min(width - sz(32), sz(520)) }]}>
      <Image
        source={{ uri: post.image_url }}
        style={fc.image}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={150}
        recyclingKey={post.id}
      />

      <LinearGradient
        colors={['rgba(0,0,0,0.75)', 'rgba(0,0,0,0.30)', 'transparent']}
        style={fc.topShadow}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.85)']}
        style={fc.bottomShadow}
        pointerEvents="none"
      />

      {/* Header: avatar + name + safety menu */}
      <View style={fc.header}>
        {post.author_avatar ? (
          <Image
            source={{ uri: post.author_avatar }}
            style={fc.avatar}
            cachePolicy="memory-disk"
            transition={150}
            recyclingKey={post.user_id}
          />
        ) : (
          <View style={fc.avatar}><Avatar uri={null} name={authorName} size={sz(38)} /></View>
        )}
        <View style={fc.headerInfo}>
          <View style={fc.nameRow}>
            <Text style={fc.name} numberOfLines={1}>{authorName}</Text>
            {post.author_verified && (
              <MaterialIcons name="verified" size={sz(15)} color={ACCENT} style={{ marginLeft: sz(4) }} accessibilityLabel="Verified" />
            )}
          </View>
          <Text style={fc.category} numberOfLines={1}>
            {category ? `${category}, ${timeAgo(post.created_at)}` : timeAgo(post.created_at)}
          </Text>
        </View>
        {!isOwnPost && (
          <Pressable
            accessibilityLabel="Report or block"
            accessibilityRole="button"
            hitSlop={10}
            style={({ pressed }) => [fc.moreBtn, pressed && fc.pressed]}
            onPress={() =>
              openSafetyMenu({
                userId: post.user_id,
                name: authorName,
                target: { type: 'post', id: post.id },
                onBlocked: () => onAuthorBlocked(post.user_id),
              })
            }
          >
            <Ionicons name="ellipsis-horizontal" size={sz(18)} color="#FFF" />
          </Pressable>
        )}
      </View>

      {!!post.caption && (
        <View style={fc.captionBox}>
          <Text style={fc.captionText} numberOfLines={3}>{post.caption}</Text>
        </View>
      )}

      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.55)']} style={fc.statsFade} pointerEvents="none" />

      <BlurView style={fc.glassBar} intensity={40} tint="dark">
        <Pressable
          onPress={toggleLike}
          accessibilityRole="button"
          accessibilityLabel={liked ? 'Unlike' : 'Like'}
          accessibilityState={{ selected: liked }}
          hitSlop={8}
          style={({ pressed }) => [fc.stat, pressed && fc.pressed]}
        >
          <Animated.View style={{ transform: [{ scale: heartScale }] }}>
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={sz(22)} color={liked ? '#FF3B30' : '#FFF'} />
          </Animated.View>
          {post.likes_count > 0 && <Text style={fc.statTxt}>{fmtCount(post.likes_count)}</Text>}
        </Pressable>
        <Pressable
          onPress={() => onOpenComments(post)}
          accessibilityRole="button"
          accessibilityLabel={`Comments, ${post.comments_count ?? 0}`}
          hitSlop={8}
          style={({ pressed }) => [fc.stat, pressed && fc.pressed]}
        >
          <Ionicons name="chatbubble-outline" size={sz(21)} color="#FFF" />
          {!!post.comments_count && <Text style={fc.statTxt}>{fmtCount(post.comments_count)}</Text>}
        </Pressable>
        <Pressable
          onPress={sharePost}
          accessibilityRole="button"
          accessibilityLabel="Share"
          hitSlop={8}
          style={({ pressed }) => [fc.stat, pressed && fc.pressed]}
        >
          <Ionicons name="paper-plane-outline" size={sz(22)} color="#FFF" />
          {!!post.shares_count && <Text style={fc.statTxt}>{fmtCount(post.shares_count)}</Text>}
        </Pressable>
      </BlurView>
    </View>
  );
});

function PostSkeleton({ width }: { width: number }) {
  return (
    <View style={[fc.card, fc.skeletonCard, { width: Math.min(width - sz(32), sz(520)) }]}>
      <View style={fc.header}>
        <View style={[fc.avatar, { backgroundColor: '#262626', borderWidth: 0 }]} />
        <View style={fc.headerInfo}>
          <View style={[s.skeletonLine, { width: sz(120) }]} />
          <View style={[s.skeletonLine, { width: sz(80), marginTop: sz(8) }]} />
        </View>
      </View>
    </View>
  );
}

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
  const avatar = item.avatar || item.logo;

  return (
    <Pressable
      style={({ pressed }) => [st.storyWrap, pressed && fc.pressed]}
      accessibilityRole="button"
      accessibilityLabel={item.isMe ? 'Your story, create' : `${item.name}'s story`}
      onPress={() => onPress(item, index)}
    >
      {hasStory ? (
        <LinearGradient colors={[ACCENT, '#FF9A3D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.ring}>
          <View style={st.logoCircle}>
            <Avatar uri={avatar} name={item.name || '?'} size={sz(54)} />
          </View>
        </LinearGradient>
      ) : (
        <View style={[st.ring, st.ringEmpty]}>
          <View style={st.logoCircle}>
            <Avatar uri={avatar} name={item.name || '?'} size={sz(54)} />
          </View>
        </View>
      )}
      {item.isMe && (
        <View style={st.plusBadge} pointerEvents="none">
          <AntDesign name="plus" size={sz(11)} color="#111" />
        </View>
      )}
      <Text style={[st.storyName, item.isMe && { color: '#9A9A9A' }]} numberOfLines={1}>
        {item.isMe ? 'Your story' : item.name}
      </Text>
    </Pressable>
  );
});

export default function BrandHomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { width } = useWindowDimensions();

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

  const renderPost = useCallback(
    ({ item }: { item: Post }) => (
      <FeedPostCard
        post={item}
        width={width}
        isOwnPost={item.user_id === user?.id}
        reduceMotion={reduceMotion}
        onToggleLike={handleToggleLike}
        onAuthorBlocked={handleAuthorBlocked}
        onOpenComments={handleOpenComments}
        onShared={handleShared}
      />
    ),
    [width, user?.id, reduceMotion, handleToggleLike, handleAuthorBlocked, handleOpenComments, handleShared],
  );

  const keyExtractor = useCallback((item: Post) => item.id, []);

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

  // A ScrollView is fine for a row this short. Memoised so a like or a new
  // feed page doesn't re-render it.
  const listHeader = useMemo(() => (
    <View style={s.storiesSection}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.storiesRow}>
        {stories.map((item, index) => (
          <StoryBubble key={item.id} item={item} index={index} onPress={handleStoryPress} />
        ))}
      </ScrollView>
    </View>
  ), [stories, handleStoryPress]);

  const listEmpty = loading ? (
    // A plain View, not a fragment: the list clones this element with onLayout.
    <View>
      <PostSkeleton width={width} />
      <PostSkeleton width={width} />
    </View>
  ) : error ? (
    <View style={s.emptyState}>
      <Ionicons name="cloud-offline-outline" size={sz(36)} color="#777" />
      <Text style={s.emptyTitle}>Couldn't load the feed</Text>
      <Text style={s.emptyBody}>Check your connection and try again.</Text>
      <Pressable onPress={retry} accessibilityRole="button" style={({ pressed }) => [s.secondaryButton, pressed && fc.pressed]}>
        <Text style={s.secondaryButtonText}>Try again</Text>
      </Pressable>
    </View>
  ) : (
    <View style={s.emptyState}>
      <Ionicons name="images-outline" size={sz(36)} color="#777" />
      <Text style={s.emptyTitle}>No posts yet</Text>
      <Text style={s.emptyBody}>Posts from creators and brands will show up here.</Text>
      <Pressable
        onPress={goCreatePost}
        accessibilityRole="button"
        style={({ pressed }) => [s.secondaryButton, pressed && fc.pressed]}
      >
        <Text style={s.secondaryButtonText}>Create post</Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={s.root} edges={SAFE_EDGES}>
      <FlatList
        data={loading || error ? [] : posts}
        keyExtractor={keyExtractor}
        renderItem={renderPost}
        // Feed rows are near-full-screen photos, so the defaults (10 initial,
        // window of 21 screens) mount far more than can ever be visible.
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={5}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.feedContent}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={loadingMore ? <PostSkeleton width={width} /> : null}
        refreshing={refreshing}
        onRefresh={refresh}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (!loading && !loadingMore && hasMore && posts.length > 0) fetchPosts('more');
        }}
      />

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
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────
const st = StyleSheet.create({
  storyWrap: { alignItems: 'center', width: sz(72), marginRight: sz(14) },
  ring: { width: sz(72), height: sz(72), borderRadius: sz(36), padding: sz(3), justifyContent: 'center', alignItems: 'center' },
  ringEmpty: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)' },
  logoCircle: {
    width: '100%', height: '100%', borderRadius: sz(33), justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: '#121212', overflow: 'hidden', backgroundColor: '#1E1E1E',
  },
  plusBadge: {
    position: 'absolute', top: sz(50), right: 0, width: sz(22), height: sz(22), borderRadius: sz(11),
    backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#121212',
  },
  storyName: { color: '#E0E0E0', fontSize: sz(11), marginTop: sz(6), textAlign: 'center' },
});

const fc = StyleSheet.create({
  card: { alignSelf: 'center', aspectRatio: 0.78, borderRadius: sz(28), overflow: 'hidden', backgroundColor: '#1A1A1A', marginBottom: sz(20) },
  skeletonCard: { backgroundColor: '#1A1A1A' },
  image: { ...StyleSheet.absoluteFill as any },
  topShadow: { position: 'absolute', top: 0, left: 0, right: 0, height: sz(160) },
  bottomShadow: { position: 'absolute', bottom: 0, left: 0, right: 0, height: sz(200) },
  header: { flexDirection: 'row', alignItems: 'center', padding: sz(16), gap: sz(10) },
  avatar: { width: sz(42), height: sz(42), borderRadius: sz(21), borderWidth: 2, borderColor: '#FFF', overflow: 'hidden' },
  headerInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { color: '#FFF', fontSize: sz(15), fontWeight: '700', flexShrink: 1 },
  category: { color: 'rgba(255,255,255,0.7)', fontSize: sz(11), marginTop: 1 },
  moreBtn: {
    width: sz(34), height: sz(34), borderRadius: sz(17), backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center', alignItems: 'center',
  },
  captionBox: { position: 'absolute', bottom: sz(78), left: sz(20), right: sz(20) },
  captionText: { color: '#FFF', fontSize: sz(16), fontWeight: '500', lineHeight: sz(23) },
  statsFade: { position: 'absolute', bottom: sz(62), left: 0, right: 0, height: sz(60) },
  glassBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: sz(62),
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: sz(24), gap: sz(28),
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.15)', overflow: 'hidden',
  },
  stat: { flexDirection: 'row', alignItems: 'center', gap: sz(6), paddingVertical: sz(6) },
  statTxt: { color: '#FFF', fontSize: sz(15), fontWeight: '600', fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
});

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#121212' },
  storiesSection: { paddingTop: sz(16), paddingBottom: sz(8) },
  storiesRow: { paddingHorizontal: sz(16) },
  feedContent: { paddingBottom: tabBarClearance(90) },
  skeletonLine: { height: sz(10), borderRadius: sz(5), backgroundColor: '#262626' },
  emptyState: { alignItems: 'center', paddingVertical: sz(64), paddingHorizontal: sz(32) },
  emptyTitle: { color: '#FFF', fontSize: sz(17), fontWeight: '600', marginTop: sz(14) },
  emptyBody: { color: '#9A9A9A', fontSize: sz(13), lineHeight: sz(19), textAlign: 'center', marginTop: sz(6), marginBottom: sz(20) },
  secondaryButton: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: sz(12),
    paddingVertical: sz(11), paddingHorizontal: sz(22),
  },
  secondaryButtonText: { color: '#FFF', fontSize: sz(15), fontWeight: '600' },
});
