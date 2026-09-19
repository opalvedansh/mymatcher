import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getPost } from '@/api';
import api from '@/api/client';
import CommentsSheet from '@/components/CommentsSheet';
import { openSafetyMenu } from '@/components/safetyMenu';
import { useAuth } from '@/contexts/AuthContext';
import { sharePost as sharePostToOS } from '@/utils/postShare';
import { timeAgo } from '@/utils/relativeTime';
import type { Post } from '@/components/PostCard';

const ACCENT = '#FF6B2B';
const LIKE_RED = '#FF3B30';
const MUTED = '#9A9A9A';

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * A single post: what a shared link opens.
 *
 * The route lives at /p/[id] so one path serves everything. The share URL is
 * https://<host>/p/<id>, the custom scheme is matchr://p/<id>, and both land
 * here without a redirect layer in between.
 */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [liking, setLiking] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const heartScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    setFailed(false);
    try {
      const res = await getPost(id);
      setPost(res.post);
    } catch (err: any) {
      // A removed post and a dead network need different copy: one is final,
      // the other is worth retrying.
      if (err?.status === 404) setNotFound(true);
      else setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleLike = async () => {
    if (!post || liking) return;
    const nextLiked = !post.liked_by_me;
    const nextCount = Math.max(0, post.likes_count + (nextLiked ? 1 : -1));
    setPost({ ...post, liked_by_me: nextLiked, likes_count: nextCount });
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
      setPost((p) => (p ? { ...p, liked_by_me: !nextLiked, likes_count: post.likes_count } : p));
    } finally {
      setLiking(false);
    }
  };

  const share = async () => {
    if (!post) return;
    const count = await sharePostToOS(post);
    if (count !== null) setPost((p) => (p ? { ...p, shares_count: count } : p));
  };

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.topBar}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color="#FFF" />
        </Pressable>
        <Text style={s.topTitle}>Post</Text>
        {post && post.user_id !== user?.id ? (
          <Pressable
            onPress={() =>
              openSafetyMenu({
                userId: post.user_id,
                name: post.author_name || 'this creator',
                target: { type: 'post', id: post.id },
                onBlocked: goBack,
              })
            }
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Report or block"
          >
            <Ionicons name="ellipsis-horizontal" size={20} color="#FFF" />
          </Pressable>
        ) : (
          <View style={{ width: 20 }} />
        )}
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={ACCENT} />
        </View>
      ) : notFound ? (
        <View style={s.center}>
          <Ionicons name="image-outline" size={34} color="#262626" />
          <Text style={s.emptyTitle}>Post unavailable</Text>
          <Text style={s.emptyBody}>It was removed, or the account no longer exists.</Text>
          <Pressable onPress={goBack} style={s.cta} accessibilityRole="button">
            <Text style={s.ctaText}>Back to feed</Text>
          </Pressable>
        </View>
      ) : failed ? (
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={34} color="#262626" />
          <Text style={s.emptyTitle}>Could not load this post</Text>
          <Text style={s.emptyBody}>Check your connection and try again.</Text>
          <Pressable onPress={load} style={s.cta} accessibilityRole="button">
            <Text style={s.ctaText}>Try again</Text>
          </Pressable>
        </View>
      ) : post ? (
        <ScrollView contentContainerStyle={s.body}>
          <Pressable
            style={s.author}
            onPress={() => router.push(`/profile/${post.user_id}`)}
            accessibilityRole="button"
            accessibilityLabel={`View ${post.author_name || 'profile'}`}
          >
            <Image
              source={{ uri: post.author_avatar || `https://picsum.photos/seed/${post.user_id}/80/80` }}
              style={s.avatar}
              cachePolicy="memory-disk"
              transition={140}
            />
            <View style={s.authorInfo}>
              <View style={s.nameRow}>
                <Text style={s.name} numberOfLines={1}>{post.author_name || 'Creator'}</Text>
                {post.author_verified && (
                  <MaterialIcons name="verified" size={15} color={ACCENT} style={{ marginLeft: 4 }} />
                )}
              </View>
              <Text style={s.meta}>
                {post.author_categories?.[0]
                  ? `${post.author_categories[0]}, ${timeAgo(post.created_at)}`
                  : timeAgo(post.created_at)}
              </Text>
            </View>
          </Pressable>

          <Image source={{ uri: post.image_url }} style={s.image} contentFit="cover" transition={160} />

          <View style={s.actions}>
            <Pressable
              onPress={toggleLike}
              hitSlop={8}
              style={({ pressed }) => [s.action, pressed && s.pressed]}
              accessibilityRole="button"
              accessibilityLabel={post.liked_by_me ? 'Unlike' : 'Like'}
              accessibilityState={{ selected: !!post.liked_by_me }}
            >
              <Animated.View style={{ transform: [{ scale: heartScale }] }}>
                <Ionicons
                  name={post.liked_by_me ? 'heart' : 'heart-outline'}
                  size={25}
                  color={post.liked_by_me ? LIKE_RED : '#FFF'}
                />
              </Animated.View>
              {post.likes_count > 0 && <Text style={s.actionTxt}>{fmtCount(post.likes_count)}</Text>}
            </Pressable>

            <Pressable
              onPress={() => setShowComments(true)}
              hitSlop={8}
              style={({ pressed }) => [s.action, pressed && s.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Comments, ${post.comments_count ?? 0}`}
            >
              <Ionicons name="chatbubble-outline" size={23} color="#FFF" />
              {!!post.comments_count && <Text style={s.actionTxt}>{fmtCount(post.comments_count)}</Text>}
            </Pressable>

            <Pressable
              onPress={share}
              hitSlop={8}
              style={({ pressed }) => [s.action, pressed && s.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Share"
            >
              <Ionicons name="paper-plane-outline" size={23} color="#FFF" />
              {!!post.shares_count && <Text style={s.actionTxt}>{fmtCount(post.shares_count)}</Text>}
            </Pressable>
          </View>

          {!!post.caption && (
            <Text style={s.caption}>
              <Text style={s.captionAuthor}>{post.author_name || 'Creator'} </Text>
              {post.caption}
            </Text>
          )}

          <Pressable onPress={() => setShowComments(true)} style={s.commentsCta} accessibilityRole="button">
            <Text style={s.commentsCtaText}>
              {post.comments_count
                ? `View all ${fmtCount(post.comments_count)} comments`
                : 'Add a comment'}
            </Text>
          </Pressable>
        </ScrollView>
      ) : null}

      <CommentsSheet
        visible={showComments}
        postId={post?.id ?? null}
        postAuthorId={post?.user_id ?? null}
        currentUserId={user?.id ?? null}
        onCountChange={(_postId, delta) =>
          setPost((p) => (p ? { ...p, comments_count: Math.max((p.comments_count ?? 0) + delta, 0) } : p))
        }
        onViewProfile={(userId) => {
          setShowComments(false);
          router.push(`/profile/${userId}`);
        }}
        onClose={() => setShowComments(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#121212' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  topTitle: { color: '#E0E0E0', fontSize: 16, fontWeight: '600' },

  body: { paddingBottom: 40 },
  author: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#262626' },
  authorInfo: { marginLeft: 10, flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { color: '#E0E0E0', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  meta: { color: MUTED, fontSize: 12, marginTop: 1 },

  image: { width: '100%', aspectRatio: 1, backgroundColor: '#1A1A1A' },

  actions: { flexDirection: 'row', gap: 22, paddingHorizontal: 16, paddingTop: 14 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionTxt: { color: '#CFCFCF', fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.6 },

  caption: { color: '#E0E0E0', fontSize: 14, lineHeight: 20, paddingHorizontal: 16, paddingTop: 12 },
  captionAuthor: { fontWeight: '700' },

  commentsCta: { paddingHorizontal: 16, paddingTop: 12 },
  commentsCtaText: { color: MUTED, fontSize: 13, fontWeight: '600' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 6 },
  emptyTitle: { color: '#E0E0E0', fontSize: 16, fontWeight: '600', marginTop: 10 },
  emptyBody: { color: MUTED, fontSize: 13, textAlign: 'center' },
  cta: {
    marginTop: 16,
    backgroundColor: ACCENT,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 22,
  },
  ctaText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
});
