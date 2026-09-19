import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  Animated,
  Share,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import api from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { openSafetyMenu } from '@/components/safetyMenu';

export interface Post {
  id: string;
  user_id: string;
  image_url: string;
  caption?: string | null;
  likes_count: number;
  // Optional: posts returned by older endpoints predate these counters.
  comments_count?: number;
  shares_count?: number;
  created_at: string;
  author_name?: string;
  author_avatar?: string;
  author_categories?: string[];
  author_verified?: boolean;
  liked_by_me?: boolean;
}

interface PostCardProps {
  post: Post;
  onLikeToggle?: (postId: string, liked: boolean, newCount: number) => void;
  onViewProfile?: (userId: string) => void;
  onAuthorBlocked?: (userId: string) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
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
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function PostCard({ post, onLikeToggle, onViewProfile, onAuthorBlocked }: PostCardProps) {
  const { user } = useAuth();
  const isOwnPost = user?.id === post.user_id;
  const [liked, setLiked] = useState(post.liked_by_me ?? false);
  const [likesCount, setLikesCount] = useState(post.likes_count);
  const [isLiking, setIsLiking] = useState(false);
  const [showFullCaption, setShowFullCaption] = useState(false);
  const heartScale = React.useRef(new Animated.Value(1)).current;

  const handleLike = useCallback(async () => {
    if (isLiking) return;
    const newLiked = !liked;
    const newCount = newLiked ? likesCount + 1 : Math.max(0, likesCount - 1);

    // Optimistic update
    setLiked(newLiked);
    setLikesCount(newCount);
    onLikeToggle?.(post.id, newLiked, newCount);

    // Heart animation
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.4, useNativeDriver: true, speed: 40 }),
      Animated.spring(heartScale, { toValue: 1, useNativeDriver: true, speed: 40 }),
    ]).start();

    try {
      setIsLiking(true);
      await api.post(`/api/posts/${post.id}/like`, { liked: newLiked });
    } catch {
      // Revert on failure
      setLiked(!newLiked);
      setLikesCount(likesCount);
    } finally {
      setIsLiking(false);
    }
  }, [liked, likesCount, isLiking, post.id]);

  const handleShare = async () => {
    try {
      await Share.share({ message: post.caption || 'Check out this post on Matchr' });
    } catch {}
  };

  const caption = post.caption || '';
  const isLong = caption.length > 120;
  const displayCaption = isLong && !showFullCaption ? caption.slice(0, 120) + '…' : caption;

  const category = post.author_categories?.[0] || 'Creator';

  return (
    <View style={styles.card}>
      {/* ── Author Header ── */}
      <TouchableOpacity
        style={styles.header}
        onPress={() => onViewProfile?.(post.user_id)}
        activeOpacity={0.8}
      >
        <View style={styles.avatarRing}>
          <Image
            source={{ uri: post.author_avatar || 'https://picsum.photos/seed/' + post.user_id + '/80/80' }}
            style={styles.avatar}
            cachePolicy="memory-disk"
            transition={150}
            recyclingKey={post.user_id}
          />
        </View>
        <View style={styles.authorInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.authorName} numberOfLines={1}>
              {post.author_name || 'Creator'}
            </Text>
            {post.author_verified && (
              <MaterialCommunityIcons name="check-decagram" size={14} color="#1DA1F2" style={{ marginLeft: 4 }} />
            )}
          </View>
          <Text style={styles.meta}>{category} · {timeAgo(post.created_at)}</Text>
        </View>
        <Pressable style={styles.followBtn}>
          <Text style={styles.followBtnText}>Follow</Text>
        </Pressable>
        {!isOwnPost && (
          <Pressable
            accessibilityLabel="Report or block"
            hitSlop={8}
            style={{ marginLeft: 8 }}
            onPress={() =>
              openSafetyMenu({
                userId: post.user_id,
                name: post.author_name || 'this creator',
                target: { type: 'post', id: post.id },
                onBlocked: () => onAuthorBlocked?.(post.user_id),
              })
            }
          >
            <Ionicons name="ellipsis-horizontal" size={20} color="#FFF" />
          </Pressable>
        )}
      </TouchableOpacity>

      {/* ── Post Image ── */}
      <View style={styles.imageContainer}>
        <Image
          source={{ uri: post.image_url }}
          style={styles.postImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={150}
          recyclingKey={post.id}
        />
        {/* Top gradient for immersion */}
        <LinearGradient
          colors={['rgba(0,0,0,0.0)', 'transparent']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </View>

      {/* ── Actions + Caption Bar ── */}
      <View style={styles.footer}>
        {/* Actions row */}
        <View style={styles.actionsRow}>
          <View style={styles.leftActions}>
            {/* Like */}
            <TouchableOpacity style={styles.actionBtn} onPress={handleLike} activeOpacity={0.7}>
              <Animated.View style={{ transform: [{ scale: heartScale }] }}>
                <Ionicons
                  name={liked ? 'heart' : 'heart-outline'}
                  size={26}
                  color={liked ? '#FF3B30' : '#FFF'}
                />
              </Animated.View>
              <Text style={[styles.actionCount, liked && { color: '#FF3B30' }]}>
                {fmtCount(likesCount)}
              </Text>
            </TouchableOpacity>

            {/* Comment (placeholder) */}
            <TouchableOpacity style={styles.actionBtn} activeOpacity={0.7}>
              <Ionicons name="chatbubble-outline" size={24} color="#FFF" />
            </TouchableOpacity>

            {/* Share */}
            <TouchableOpacity style={styles.actionBtn} onPress={handleShare} activeOpacity={0.7}>
              <Ionicons name="paper-plane-outline" size={24} color="#FFF" />
            </TouchableOpacity>
          </View>

          {/* Bookmark */}
          <TouchableOpacity style={styles.actionBtn} activeOpacity={0.7}>
            <Ionicons name="bookmark-outline" size={24} color="#FFF" />
          </TouchableOpacity>
        </View>

        {/* Caption */}
        {caption.length > 0 && (
          <View style={styles.captionRow}>
            <Text style={styles.captionAuthor}>{post.author_name || 'Creator'} </Text>
            <Text style={styles.captionText} onPress={() => isLong && setShowFullCaption(v => !v)}>
              {displayCaption}
              {isLong && !showFullCaption && (
                <Text style={styles.captionMore}> more</Text>
              )}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111111',
    marginBottom: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  avatarRing: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: '#FF4500',
    padding: 2,
    overflow: 'hidden',
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
  },
  authorInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  authorName: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
    maxWidth: 160,
  },
  meta: {
    color: '#888',
    fontSize: 12,
    marginTop: 1,
  },
  followBtn: {
    backgroundColor: '#FF4500',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  followBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 4 / 5,
    overflow: 'hidden',
    backgroundColor: '#1A1A1A',
  },
  postImage: {
    width: '100%',
    height: '100%',
  },
  footer: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionCount: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  captionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 2,
  },
  captionAuthor: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  captionText: {
    color: '#CCC',
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 1,
  },
  captionMore: {
    color: '#888',
    fontSize: 13,
  },
});
