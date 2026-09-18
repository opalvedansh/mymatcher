import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Animated,
  AccessibilityInfo,
  useWindowDimensions,
} from 'react-native';
import { AntDesign, Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { getFeedStories, uploadImage, uploadStory } from '@/api';
import api from '@/api/client';
import { StoryViewer } from '@/components/StoryViewer';
import { Avatar } from '@/components/ChatAvatar';
import { showAlert } from '@/components/ActionSheet';
import { openSafetyMenu } from '@/components/safetyMenu';
import { useAuth } from '@/contexts/AuthContext';
import type { Post } from '@/components/PostCard';

const ACCENT = '#FF6B2B';
const PAGE_SIZE = 20;

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
function FeedPostCard({
  post,
  width,
  isOwnPost,
  reduceMotion,
  onLikeChange,
  onAuthorBlocked,
}: {
  post: Post;
  width: number;
  isOwnPost: boolean;
  reduceMotion: boolean;
  onLikeChange: (postId: string, liked: boolean, count: number) => void;
  onAuthorBlocked: (userId: string) => void;
}) {
  const [liking, setLiking] = useState(false);
  const heartScale = useRef(new Animated.Value(1)).current;
  const liked = !!post.liked_by_me;
  const authorName = post.author_name || 'Creator';
  const category = post.author_categories?.[0];

  const toggleLike = async () => {
    if (liking) return;
    const nextLiked = !liked;
    onLikeChange(post.id, nextLiked, Math.max(0, post.likes_count + (nextLiked ? 1 : -1)));
    if (!reduceMotion) {
      Animated.sequence([
        Animated.spring(heartScale, { toValue: 1.3, useNativeDriver: Platform.OS !== 'web', speed: 40 }),
        Animated.spring(heartScale, { toValue: 1, useNativeDriver: Platform.OS !== 'web', speed: 40 }),
      ]).start();
    }
    try {
      setLiking(true);
      await api.post(`/api/posts/${post.id}/like`, { liked: nextLiked });
    } catch {
      onLikeChange(post.id, liked, post.likes_count);
    } finally {
      setLiking(false);
    }
  };

  const sharePost = () => {
    Share.share({ message: post.caption || 'Check out this post on Matchr' }).catch(() => {});
  };

  return (
    <View style={[fc.card, { width: Math.min(width - 32, 520) }]}>
      <Image source={{ uri: post.image_url }} style={fc.image} resizeMode="cover" />

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
          <Image source={{ uri: post.author_avatar }} style={fc.avatar} />
        ) : (
          <View style={fc.avatar}><Avatar uri={null} name={authorName} size={38} /></View>
        )}
        <View style={fc.headerInfo}>
          <View style={fc.nameRow}>
            <Text style={fc.name} numberOfLines={1}>{authorName}</Text>
            {post.author_verified && (
              <MaterialIcons name="verified" size={15} color={ACCENT} style={{ marginLeft: 4 }} accessibilityLabel="Verified" />
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
            <Ionicons name="ellipsis-horizontal" size={18} color="#FFF" />
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
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={22} color={liked ? '#FF3B30' : '#FFF'} />
          </Animated.View>
          <Text style={fc.statTxt}>{fmtCount(post.likes_count)}</Text>
        </Pressable>
        <Pressable
          onPress={sharePost}
          accessibilityRole="button"
          accessibilityLabel="Share"
          hitSlop={8}
          style={({ pressed }) => [fc.stat, pressed && fc.pressed]}
        >
          <Ionicons name="paper-plane-outline" size={22} color="#FFF" />
          <Text style={fc.statTxt}>Share</Text>
        </Pressable>
      </BlurView>
    </View>
  );
}

function PostSkeleton({ width }: { width: number }) {
  return (
    <View style={[fc.card, fc.skeletonCard, { width: Math.min(width - 32, 520) }]}>
      <View style={fc.header}>
        <View style={[fc.avatar, { backgroundColor: '#262626', borderWidth: 0 }]} />
        <View style={fc.headerInfo}>
          <View style={[s.skeletonLine, { width: 120 }]} />
          <View style={[s.skeletonLine, { width: 80, marginTop: 8 }]} />
        </View>
      </View>
    </View>
  );
}

export default function BrandHomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { width } = useWindowDimensions();

  const [stories, setStories] = useState<any[]>([]);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const fetchStories = async () => {
    try {
      const res = await getFeedStories() as any;
      setStories(res.data || res);
    } catch (e) {
      console.log('Failed to fetch stories', e);
    }
  };

  const fetchPosts = useCallback(async (mode: 'initial' | 'refresh' | 'more') => {
    const offset = mode === 'more' ? posts.length : 0;
    if (mode === 'refresh') setRefreshing(true);
    if (mode === 'more') setLoadingMore(true);
    try {
      const res = await api.get(`/api/posts/feed?limit=${PAGE_SIZE}&offset=${offset}`) as any;
      const page: Post[] = res.data?.posts || res.posts || [];
      setPosts(prev => {
        if (mode !== 'more') return page;
        const seen = new Set(prev.map(p => p.id));
        return [...prev, ...page.filter(p => !seen.has(p.id))];
      });
      setHasMore(page.length === PAGE_SIZE);
      setError(false);
    } catch (e) {
      console.log('Failed to fetch posts', e);
      if (mode !== 'more') setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [posts.length]);

  useEffect(() => {
    fetchStories();
    fetchPosts('initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = () => {
    fetchStories();
    fetchPosts('refresh');
  };

  const retry = () => {
    setLoading(true);
    setError(false);
    fetchPosts('initial');
  };

  const handleLikeChange = (postId: string, liked: boolean, count: number) => {
    setPosts(prev => prev.map(p => (p.id === postId ? { ...p, liked_by_me: liked, likes_count: count } : p)));
  };

  const handleAddStory = async () => {
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
  };

  const openCreateMenu = (hasStory: boolean) => {
    showAlert('Create', undefined, [
      ...(hasStory
        ? [{
            text: 'View your story',
            icon: 'play-circle-outline' as const,
            onPress: () => {
              setSelectedGroupIndex(stories.findIndex(s => s.isMe));
              setViewerVisible(true);
            },
          }]
        : []),
      { text: 'Add to story', icon: 'add-circle-outline', onPress: handleAddStory },
      { text: 'Create post', icon: 'images-outline', onPress: () => router.push('/create-post') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const renderStoryItem = (item: any, index: number) => {
    const hasStory = !!item.items?.length;
    const avatar = item.avatar || item.logo;

    return (
      <Pressable
        key={item.id}
        style={({ pressed }) => [st.storyWrap, pressed && fc.pressed]}
        accessibilityRole="button"
        accessibilityLabel={item.isMe ? 'Your story, create' : `${item.name}'s story`}
        onPress={() => {
          if (item.isMe) {
            openCreateMenu(hasStory);
          } else {
            setSelectedGroupIndex(index);
            setViewerVisible(true);
          }
        }}
      >
        {hasStory ? (
          <LinearGradient colors={[ACCENT, '#FF9A3D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.ring}>
            <View style={st.logoCircle}>
              <Avatar uri={avatar} name={item.name || '?'} size={54} />
            </View>
          </LinearGradient>
        ) : (
          <View style={[st.ring, st.ringEmpty]}>
            <View style={st.logoCircle}>
              <Avatar uri={avatar} name={item.name || '?'} size={54} />
            </View>
          </View>
        )}
        {item.isMe && (
          <View style={st.plusBadge} pointerEvents="none">
            <AntDesign name="plus" size={11} color="#111" />
          </View>
        )}
        <Text style={[st.storyName, item.isMe && { color: '#9A9A9A' }]} numberOfLines={1}>
          {item.isMe ? 'Your story' : item.name}
        </Text>
      </Pressable>
    );
  };

  const listHeader = (
    <View style={s.storiesSection}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.storiesRow}>
        {stories.map((item, index) => renderStoryItem(item, index))}
      </ScrollView>
    </View>
  );

  const listEmpty = loading ? (
    // A plain View, not a fragment: the list clones this element with onLayout.
    <View>
      <PostSkeleton width={width} />
      <PostSkeleton width={width} />
    </View>
  ) : error ? (
    <View style={s.emptyState}>
      <Ionicons name="cloud-offline-outline" size={36} color="#777" />
      <Text style={s.emptyTitle}>Couldn't load the feed</Text>
      <Text style={s.emptyBody}>Check your connection and try again.</Text>
      <Pressable onPress={retry} accessibilityRole="button" style={({ pressed }) => [s.secondaryButton, pressed && fc.pressed]}>
        <Text style={s.secondaryButtonText}>Try again</Text>
      </Pressable>
    </View>
  ) : (
    <View style={s.emptyState}>
      <Ionicons name="images-outline" size={36} color="#777" />
      <Text style={s.emptyTitle}>No posts yet</Text>
      <Text style={s.emptyBody}>Posts from creators and brands will show up here.</Text>
      <Pressable
        onPress={() => router.push('/create-post')}
        accessibilityRole="button"
        style={({ pressed }) => [s.secondaryButton, pressed && fc.pressed]}
      >
        <Text style={s.secondaryButtonText}>Create post</Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={s.root}>
      <FlatList
        data={loading || error ? [] : posts}
        keyExtractor={i => i.id}
        renderItem={({ item }) => (
          <FeedPostCard
            post={item}
            width={width}
            isOwnPost={item.user_id === user?.id}
            reduceMotion={reduceMotion}
            onLikeChange={handleLikeChange}
            onAuthorBlocked={(authorId) => setPosts(prev => prev.filter(p => p.user_id !== authorId))}
          />
        )}
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

      <StoryViewer
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
  storyWrap: { alignItems: 'center', width: 72, marginRight: 14 },
  ring: { width: 72, height: 72, borderRadius: 36, padding: 3, justifyContent: 'center', alignItems: 'center' },
  ringEmpty: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)' },
  logoCircle: {
    width: '100%', height: '100%', borderRadius: 33, justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: '#121212', overflow: 'hidden', backgroundColor: '#1E1E1E',
  },
  plusBadge: {
    position: 'absolute', top: 50, right: 0, width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#121212',
  },
  storyName: { color: '#E0E0E0', fontSize: 11, marginTop: 6, textAlign: 'center' },
});

const fc = StyleSheet.create({
  card: { alignSelf: 'center', aspectRatio: 0.78, borderRadius: 28, overflow: 'hidden', backgroundColor: '#1A1A1A', marginBottom: 20 },
  skeletonCard: { backgroundColor: '#1A1A1A' },
  image: { ...StyleSheet.absoluteFill as any },
  topShadow: { position: 'absolute', top: 0, left: 0, right: 0, height: 160 },
  bottomShadow: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 200 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, borderColor: '#FFF', overflow: 'hidden' },
  headerInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { color: '#FFF', fontSize: 15, fontWeight: '700', flexShrink: 1 },
  category: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 1 },
  moreBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center', alignItems: 'center',
  },
  captionBox: { position: 'absolute', bottom: 78, left: 20, right: 20 },
  captionText: { color: '#FFF', fontSize: 16, fontWeight: '500', lineHeight: 23 },
  statsFade: { position: 'absolute', bottom: 62, left: 0, right: 0, height: 60 },
  glassBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 62,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, gap: 28,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.15)', overflow: 'hidden',
  },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  statTxt: { color: '#FFF', fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
});

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#121212' },
  storiesSection: { paddingTop: 16, paddingBottom: 8 },
  storiesRow: { paddingHorizontal: 16 },
  feedContent: { paddingBottom: 90 },
  skeletonLine: { height: 10, borderRadius: 5, backgroundColor: '#262626' },
  emptyState: { alignItems: 'center', paddingVertical: 64, paddingHorizontal: 32 },
  emptyTitle: { color: '#FFF', fontSize: 17, fontWeight: '600', marginTop: 14 },
  emptyBody: { color: '#9A9A9A', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6, marginBottom: 20 },
  secondaryButton: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 12,
    paddingVertical: 11, paddingHorizontal: 22,
  },
  secondaryButtonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
});
