import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createPostComment,
  deletePostComment,
  getCommentReplies,
  getPostComments,
  likePostComment,
  type PostComment,
} from '@/api';
import { timeAgo } from '@/utils/relativeTime';

const ACCENT = '#FF6B2B';
const LIKE_RED = '#FF3B30';
const SURFACE = '#161616';
const BORDER = '#262626';
const TEXT = '#E0E0E0';
const MUTED = '#9A9A9A';

const PAGE = 20;

/**
 * Comments for one post, as a sheet over the feed.
 *
 * Replies are one level deep and start collapsed: a thread only loads when
 * someone asks for it, so a post with fifty replies still opens instantly.
 *
 * Writes are optimistic. A new comment appears immediately with a pending
 * flag, and a failure rolls it back and puts the text back in the composer
 * rather than dropping what the person typed.
 */
export interface CommentsSheetProps {
  visible: boolean;
  postId: string | null;
  /**
   * Change in the post's comment count, signed. The sheet paginates, so it
   * never knows the true total; the feed card applies the delta to its own.
   */
  onCountChange?: (postId: string, delta: number) => void;
  onViewProfile?: (userId: string) => void;
  onClose: () => void;
  /** Current user, so their own comments offer delete. */
  currentUserId?: string | null;
  /** Post author, who may also delete comments on their post. */
  postAuthorId?: string | null;
}

type Pending = PostComment & { pending?: true; failed?: true };

export default function CommentsSheet({
  visible,
  postId,
  onCountChange,
  onViewProfile,
  onClose,
  currentUserId,
  postAuthorId,
}: CommentsSheetProps) {
  const insets = useSafeAreaInsets();

  const [comments, setComments] = useState<Pending[]>([]);
  const [replies, setReplies] = useState<Record<string, PostComment[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loadingReplies, setLoadingReplies] = useState<Record<string, boolean>>({});
  const [nextBefore, setNextBefore] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [sending, setSending] = useState(false);

  const inputRef = useRef<TextInput>(null);

  // ── Drag to dismiss ──────────────────────────────────────────────
  const translateY = useRef(new Animated.Value(0)).current;
  const pan = useRef(
    PanResponder.create({
      // Only the grabber claims the gesture, so the list keeps its own scroll.
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 4,
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 120 || g.vy > 0.8) {
          Animated.timing(translateY, {
            toValue: 600,
            duration: 160,
            useNativeDriver: true,
          }).start(() => onClose());
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
        }
      },
    })
  ).current;

  // ── Load ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!postId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getPostComments(postId, PAGE);
      setComments(res.comments);
      setNextBefore(res.next_before);
    } catch {
      setError('Could not load comments.');
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    if (!visible || !postId) return;
    translateY.setValue(0);
    setComments([]);
    setReplies({});
    setExpanded({});
    setNextBefore(null);
    setReplyTo(null);
    setDraft('');
    load();
  }, [visible, postId, load, translateY]);

  const loadMore = useCallback(async () => {
    if (!postId || !nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await getPostComments(postId, PAGE, nextBefore);
      setComments((prev) => [...prev, ...res.comments]);
      setNextBefore(res.next_before);
    } catch {
      // Keep what is already on screen; the footer stays tappable to retry.
    } finally {
      setLoadingMore(false);
    }
  }, [postId, nextBefore, loadingMore]);

  const toggleReplies = useCallback(
    async (comment: PostComment) => {
      const open = expanded[comment.id];
      setExpanded((prev) => ({ ...prev, [comment.id]: !open }));
      if (open || replies[comment.id] || !postId) return;

      setLoadingReplies((prev) => ({ ...prev, [comment.id]: true }));
      try {
        const res = await getCommentReplies(postId, comment.id, PAGE);
        setReplies((prev) => ({ ...prev, [comment.id]: res.replies }));
      } catch {
        setExpanded((prev) => ({ ...prev, [comment.id]: false }));
      } finally {
        setLoadingReplies((prev) => ({ ...prev, [comment.id]: false }));
      }
    },
    [expanded, replies, postId]
  );

  // ── Write ────────────────────────────────────────────────────────
  const bumpCount = useCallback(
    (delta: number) => {
      if (postId) onCountChange?.(postId, delta);
    },
    [postId, onCountChange]
  );

  const submit = useCallback(async () => {
    const body = draft.trim();
    if (!body || !postId || sending) return;

    const parent = replyTo;
    const tempId = `pending-${Date.now()}`;
    const optimistic: Pending = {
      id: tempId,
      post_id: postId,
      user_id: currentUserId || '',
      parent_id: parent?.id ?? null,
      body,
      likes_count: 0,
      replies_count: 0,
      edited_at: null,
      created_at: new Date().toISOString(),
      liked_by_me: false,
      pending: true,
    };

    setDraft('');
    setReplyTo(null);
    setSending(true);

    if (parent) {
      setExpanded((prev) => ({ ...prev, [parent.id]: true }));
      setReplies((prev) => ({ ...prev, [parent.id]: [...(prev[parent.id] || []), optimistic] }));
    } else {
      setComments((prev) => [optimistic, ...prev]);
    }
    bumpCount(1);

    try {
      const { comment } = await createPostComment(postId, body, parent?.id);
      if (parent) {
        setReplies((prev) => ({
          ...prev,
          [parent.id]: (prev[parent.id] || []).map((c) => (c.id === tempId ? comment : c)),
        }));
        setComments((prev) =>
          prev.map((c) => (c.id === parent.id ? { ...c, replies_count: c.replies_count + 1 } : c))
        );
      } else {
        setComments((prev) => prev.map((c) => (c.id === tempId ? comment : c)));
      }
    } catch {
      // Roll back and hand the text back rather than losing it.
      if (parent) {
        setReplies((prev) => ({
          ...prev,
          [parent.id]: (prev[parent.id] || []).filter((c) => c.id !== tempId),
        }));
      } else {
        setComments((prev) => prev.filter((c) => c.id !== tempId));
      }
      bumpCount(-1);
      setDraft(body);
      setReplyTo(parent);
      setError('Comment failed to send. Tap Post to try again.');
    } finally {
      setSending(false);
    }
  }, [draft, postId, sending, replyTo, currentUserId, bumpCount]);

  const toggleCommentLike = useCallback(
    async (comment: PostComment, parentId?: string) => {
      if (!postId) return;
      const next = !comment.liked_by_me;
      const delta = next ? 1 : -1;
      const apply = (c: PostComment) =>
        c.id === comment.id
          ? { ...c, liked_by_me: next, likes_count: Math.max(c.likes_count + delta, 0) }
          : c;

      if (parentId) {
        setReplies((prev) => ({ ...prev, [parentId]: (prev[parentId] || []).map(apply) }));
      } else {
        setComments((prev) => prev.map(apply));
      }

      try {
        await likePostComment(postId, comment.id, next);
      } catch {
        const revert = (c: PostComment) =>
          c.id === comment.id
            ? { ...c, liked_by_me: !next, likes_count: Math.max(c.likes_count - delta, 0) }
            : c;
        if (parentId) {
          setReplies((prev) => ({ ...prev, [parentId]: (prev[parentId] || []).map(revert) }));
        } else {
          setComments((prev) => prev.map(revert));
        }
      }
    },
    [postId]
  );

  const remove = useCallback(
    async (comment: PostComment, parentId?: string) => {
      if (!postId) return;
      const removedReplies = parentId ? 0 : comment.replies_count;

      if (parentId) {
        setReplies((prev) => ({
          ...prev,
          [parentId]: (prev[parentId] || []).filter((c) => c.id !== comment.id),
        }));
        setComments((prev) =>
          prev.map((c) =>
            c.id === parentId ? { ...c, replies_count: Math.max(c.replies_count - 1, 0) } : c
          )
        );
      } else {
        setComments((prev) => prev.filter((c) => c.id !== comment.id));
      }
      bumpCount(-(1 + removedReplies));

      try {
        await deletePostComment(postId, comment.id);
      } catch {
        setError('Could not delete that comment.');
        load();
      }
    },
    [postId, bumpCount, load]
  );

  const canDelete = (c: PostComment) =>
    !!currentUserId && (c.user_id === currentUserId || postAuthorId === currentUserId);

  // ── Render ───────────────────────────────────────────────────────
  const renderComment = (
    comment: Pending,
    { isReply = false, parentId }: { isReply?: boolean; parentId?: string } = {}
  ) => (
    <View
      key={comment.id}
      style={[styles.row, isReply && styles.replyRow, comment.pending && styles.rowPending]}
    >
      <Pressable
        onPress={() => comment.user_id && onViewProfile?.(comment.user_id)}
        accessibilityRole="button"
        accessibilityLabel={`View ${comment.author_name || 'profile'}`}
      >
        <Image
          source={{
            uri:
              comment.author_avatar ||
              `https://picsum.photos/seed/${comment.user_id || 'anon'}/64/64`,
          }}
          style={[styles.avatar, isReply && styles.avatarSmall]}
          cachePolicy="memory-disk"
          transition={120}
          recyclingKey={comment.user_id}
        />
      </Pressable>

      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {comment.author_name || 'Someone'}
          </Text>
          {comment.author_verified && (
            <MaterialCommunityIcons
              name="check-decagram"
              size={12}
              color="#1DA1F2"
              style={{ marginLeft: 3 }}
            />
          )}
          <Text style={styles.time}>{timeAgo(comment.created_at)}</Text>
        </View>

        <Text style={styles.text}>{comment.body}</Text>

        <View style={styles.actions}>
          {!comment.pending && (
            <Pressable
              onPress={() => {
                setReplyTo(isReply && parentId ? ({ ...comment, id: parentId } as PostComment) : comment);
                inputRef.current?.focus();
              }}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={styles.actionText}>Reply</Text>
            </Pressable>
          )}
          {canDelete(comment) && !comment.pending && (
            <Pressable onPress={() => remove(comment, parentId)} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.actionText, { color: LIKE_RED }]}>Delete</Text>
            </Pressable>
          )}
          {comment.pending && <Text style={styles.actionText}>Sending…</Text>}
        </View>

        {!isReply && comment.replies_count > 0 && (
          <Pressable onPress={() => toggleReplies(comment)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.repliesToggle}>
              {loadingReplies[comment.id]
                ? 'Loading replies…'
                : expanded[comment.id]
                  ? 'Hide replies'
                  : `View ${comment.replies_count} ${comment.replies_count === 1 ? 'reply' : 'replies'}`}
            </Text>
          </Pressable>
        )}

        {!isReply &&
          expanded[comment.id] &&
          (replies[comment.id] || []).map((r) =>
            renderComment(r as Pending, { isReply: true, parentId: comment.id })
          )}
      </View>

      {!comment.pending && (
        <Pressable
          onPress={() => toggleCommentLike(comment, parentId)}
          hitSlop={10}
          style={styles.likeBtn}
          accessibilityRole="button"
          accessibilityLabel={comment.liked_by_me ? 'Unlike comment' : 'Like comment'}
          accessibilityState={{ selected: !!comment.liked_by_me }}
        >
          <Ionicons
            name={comment.liked_by_me ? 'heart' : 'heart-outline'}
            size={15}
            color={comment.liked_by_me ? LIKE_RED : MUTED}
          />
          {comment.likes_count > 0 && <Text style={styles.likeCount}>{comment.likes_count}</Text>}
        </Pressable>
      )}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} accessibilityLabel="Close comments" />

        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View {...pan.panHandlers} style={styles.grabArea}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <Text style={styles.title}>Comments</Text>
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={MUTED} />
              </Pressable>
            </View>
          </View>

          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          >
            {loading ? (
              <CommentSkeletons />
            ) : error && comments.length === 0 ? (
              <View style={styles.center}>
                <Text style={styles.emptyTitle}>{error}</Text>
                <Pressable onPress={load} style={styles.retry} accessibilityRole="button">
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </View>
            ) : (
              <FlatList
                data={comments}
                keyExtractor={(c) => c.id}
                renderItem={({ item }) => renderComment(item)}
                onEndReached={loadMore}
                onEndReachedThreshold={0.4}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={comments.length === 0 && styles.flexGrow}
                ListEmptyComponent={
                  <View style={styles.center}>
                    <Ionicons name="chatbubble-outline" size={30} color={BORDER} />
                    <Text style={styles.emptyTitle}>No comments yet</Text>
                    <Text style={styles.emptyBody}>Be the first to say something.</Text>
                  </View>
                }
                ListFooterComponent={
                  loadingMore ? <ActivityIndicator color={MUTED} style={{ paddingVertical: 16 }} /> : null
                }
              />
            )}

            <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
              {replyTo && (
                <View style={styles.replyBanner}>
                  <Text style={styles.replyBannerText} numberOfLines={1}>
                    Replying to {replyTo.author_name || 'someone'}
                  </Text>
                  <Pressable onPress={() => setReplyTo(null)} hitSlop={8} accessibilityLabel="Cancel reply">
                    <Ionicons name="close" size={15} color={MUTED} />
                  </Pressable>
                </View>
              )}
              <View style={styles.composerRow}>
                <TextInput
                  ref={inputRef}
                  value={draft}
                  onChangeText={(t) => {
                    setDraft(t);
                    if (error) setError(null);
                  }}
                  placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
                  placeholderTextColor={MUTED}
                  style={styles.input}
                  multiline
                  maxLength={2200}
                  accessibilityLabel="Comment text"
                />
                <Pressable
                  onPress={submit}
                  disabled={!draft.trim() || sending}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.postBtn,
                    (!draft.trim() || sending) && styles.postBtnOff,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Post comment"
                  accessibilityState={{ disabled: !draft.trim() || sending }}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text style={styles.postBtnText}>Post</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Matches the real row's shape so the list does not jump when data lands. */
function CommentSkeletons() {
  return (
    <View style={{ paddingTop: 6 }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.row}>
          <View style={[styles.avatar, styles.skeleton]} />
          <View style={styles.body}>
            <View style={[styles.skeleton, styles.skelLine, { width: 96 }]} />
            <View style={[styles.skeleton, styles.skelLine, { width: '82%' }]} />
            <View style={[styles.skeleton, styles.skelLine, { width: '54%' }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexGrow: { flexGrow: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  backdropFill: { flex: 1 },

  sheet: {
    height: '78%',
    backgroundColor: SURFACE,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  grabArea: { paddingTop: 8 },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: BORDER,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  title: { color: TEXT, fontSize: 16, fontWeight: '600' },

  row: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10 },
  replyRow: { paddingHorizontal: 0, paddingRight: 0, paddingTop: 10, paddingBottom: 2 },
  rowPending: { opacity: 0.55 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: BORDER },
  avatarSmall: { width: 26, height: 26, borderRadius: 13 },
  body: { flex: 1, marginLeft: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { color: TEXT, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  time: { color: MUTED, fontSize: 11, marginLeft: 8 },
  text: { color: TEXT, fontSize: 14, lineHeight: 19, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 16, marginTop: 5 },
  actionText: { color: MUTED, fontSize: 12, fontWeight: '600' },
  repliesToggle: { color: MUTED, fontSize: 12, fontWeight: '600', marginTop: 8 },

  likeBtn: { alignItems: 'center', paddingLeft: 10, paddingTop: 2, minWidth: 26 },
  likeCount: { color: MUTED, fontSize: 11, marginTop: 2 },

  center: { alignItems: 'center', justifyContent: 'center', flex: 1, padding: 32, gap: 6 },
  emptyTitle: { color: TEXT, fontSize: 15, fontWeight: '600', marginTop: 8, textAlign: 'center' },
  emptyBody: { color: MUTED, fontSize: 13, textAlign: 'center' },
  retry: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  retryText: { color: TEXT, fontSize: 13, fontWeight: '600' },

  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: SURFACE,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  replyBannerText: { color: MUTED, fontSize: 12, flexShrink: 1 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    color: TEXT,
    fontSize: 14,
    maxHeight: 110,
    minHeight: 40,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 11 : 8,
    paddingBottom: Platform.OS === 'ios' ? 11 : 8,
    borderRadius: 20,
    backgroundColor: '#1F1F1F',
  },
  postBtn: {
    backgroundColor: ACCENT,
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 62,
  },
  // Dimmed, not greyed: white on this orange still clears AA at 14px semibold.
  postBtnOff: { opacity: 0.4 },
  postBtnText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.7 },

  skeleton: { backgroundColor: '#1F1F1F', borderRadius: 6 },
  skelLine: { height: 10, marginTop: 7 },
});
