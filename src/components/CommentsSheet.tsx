import React, { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
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
import { sz } from '@/theme/scale';

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
  const [comments, setComments] = useState<Pending[]>([]);
  const [replies, setReplies] = useState<Record<string, PostComment[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loadingReplies, setLoadingReplies] = useState<Record<string, boolean>>({});
  const [nextBefore, setNextBefore] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [replyTo, setReplyTo] = useState<PostComment | null>(null);

  const inputRef = useRef<TextInput>(null);

  // Rows are memoised, so the callbacks they get must keep their identity.
  // These refs let those callbacks read the latest values without depending
  // on them.
  const postIdRef = useRef(postId);
  postIdRef.current = postId;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const repliesRef = useRef(replies);
  repliesRef.current = replies;
  const onViewProfileRef = useRef(onViewProfile);
  onViewProfileRef.current = onViewProfile;
  // Bumped by every full load, so a slow response for an earlier post (or an
  // earlier open) can't land in this one.
  const loadSeqRef = useRef(0);

  // ── Drag to dismiss ──────────────────────────────────────────────
  const translateY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
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
          }).start(() => onCloseRef.current());
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
    const id = postIdRef.current;
    if (!id) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await getPostComments(id, PAGE);
      if (seq !== loadSeqRef.current) return;
      setComments(res.comments);
      setNextBefore(res.next_before);
    } catch {
      if (seq === loadSeqRef.current) setError('Could not load comments.');
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, []);

  // Reset for each open in a layout effect, which commits before anything is
  // drawn: the sheet never shows a frame of the previous post's comments, or
  // sits off-screen where a drag-to-dismiss left it. Not done on close, which
  // would empty the list while the sheet is still sliding away.
  useLayoutEffect(() => {
    if (!visible || !postId) return;
    translateY.setValue(0);
    setComments([]);
    setReplies({});
    setExpanded({});
    setLoadingReplies({});
    setNextBefore(null);
    setReplyTo(null);
    setError(null);
    load();
  }, [visible, postId, load, translateY]);

  const loadMore = useCallback(async () => {
    if (!postId || !nextBefore || loadingMore) return;
    const seq = loadSeqRef.current;
    setLoadingMore(true);
    try {
      const res = await getPostComments(postId, PAGE, nextBefore);
      if (seq !== loadSeqRef.current) return;
      setComments((prev) => {
        // A comment posted meanwhile shifts the page boundary, so the next
        // page can repeat a row already shown.
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...res.comments.filter((c) => !seen.has(c.id))];
      });
      setNextBefore(res.next_before);
    } catch {
      // Keep what is already on screen; the footer stays tappable to retry.
    } finally {
      setLoadingMore(false);
    }
  }, [postId, nextBefore, loadingMore]);

  const toggleReplies = useCallback(async (comment: PostComment) => {
    const id = postIdRef.current;
    const open = expandedRef.current[comment.id];
    setExpanded((prev) => ({ ...prev, [comment.id]: !open }));
    if (open || repliesRef.current[comment.id] || !id) return;

    setLoadingReplies((prev) => ({ ...prev, [comment.id]: true }));
    try {
      const res = await getCommentReplies(id, comment.id, PAGE);
      if (postIdRef.current !== id) return;
      setReplies((prev) => ({ ...prev, [comment.id]: res.replies }));
    } catch {
      setExpanded((prev) => ({ ...prev, [comment.id]: false }));
    } finally {
      setLoadingReplies((prev) => ({ ...prev, [comment.id]: false }));
    }
  }, []);

  // ── Write ────────────────────────────────────────────────────────
  const bumpCount = useCallback(
    (delta: number) => {
      if (postId) onCountChange?.(postId, delta);
    },
    [postId, onCountChange]
  );

  /** Resolves false when the send failed, so the composer restores the text. */
  const submit = useCallback(async (body: string): Promise<boolean> => {
    if (!postId) return false;

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

    setReplyTo(null);

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
      return true;
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
      setReplyTo(parent);
      setError('Comment failed to send. Tap Post to try again.');
      return false;
    }
  }, [postId, replyTo, currentUserId, bumpCount]);

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

  const startReply = useCallback((target: PostComment) => {
    setReplyTo(target);
    inputRef.current?.focus();
  }, []);

  const viewProfile = useCallback((userId: string) => onViewProfileRef.current?.(userId), []);

  const cancelReply = useCallback(() => setReplyTo(null), []);
  const clearError = useCallback(() => setError(null), []);

  // ── Render ───────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: Pending }) => (
      <CommentRow
        comment={item}
        replies={expanded[item.id] ? replies[item.id] : undefined}
        expanded={!!expanded[item.id]}
        loadingReplies={!!loadingReplies[item.id]}
        currentUserId={currentUserId}
        postAuthorId={postAuthorId}
        onViewProfile={viewProfile}
        onReply={startReply}
        onDelete={remove}
        onToggleLike={toggleCommentLike}
        onToggleReplies={toggleReplies}
      />
    ),
    [expanded, replies, loadingReplies, currentUserId, postAuthorId, viewProfile, startReply, remove, toggleCommentLike, toggleReplies]
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
                <Ionicons name="close" size={sz(22)} color={MUTED} />
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
                keyExtractor={keyExtractor}
                renderItem={renderItem}
                onEndReached={loadMore}
                onEndReachedThreshold={0.4}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={comments.length === 0 && styles.flexGrow}
                ListEmptyComponent={
                  <View style={styles.center}>
                    <Ionicons name="chatbubble-outline" size={sz(30)} color={BORDER} />
                    <Text style={styles.emptyTitle}>No comments yet</Text>
                    <Text style={styles.emptyBody}>Be the first to say something.</Text>
                  </View>
                }
                ListFooterComponent={
                  loadingMore ? <ActivityIndicator color={MUTED} style={{ paddingVertical: sz(16) }} /> : null
                }
              />
            )}

            <Composer
              inputRef={inputRef}
              replyTo={replyTo}
              hasError={!!error}
              onClearError={clearError}
              onCancelReply={cancelReply}
              onSubmit={submit}
            />
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const keyExtractor = (c: Pending) => c.id;

type CommentRowProps = {
  comment: Pending;
  isReply?: boolean;
  parentId?: string;
  /** Loaded replies, passed only while the thread is open. */
  replies?: PostComment[];
  expanded?: boolean;
  loadingReplies?: boolean;
  currentUserId?: string | null;
  postAuthorId?: string | null;
  onViewProfile: (userId: string) => void;
  onReply: (target: PostComment) => void;
  onDelete: (comment: PostComment, parentId?: string) => void;
  onToggleLike: (comment: PostComment, parentId?: string) => void;
  onToggleReplies: (comment: PostComment) => void;
};

// Memoised: a like, a reply or a page landing re-renders only the rows whose
// data changed, not every comment in the list.
const CommentRow = memo(function CommentRow({
  comment,
  isReply = false,
  parentId,
  replies,
  expanded,
  loadingReplies,
  currentUserId,
  postAuthorId,
  onViewProfile,
  onReply,
  onDelete,
  onToggleLike,
  onToggleReplies,
}: CommentRowProps) {
  const canDelete =
    !!currentUserId && (comment.user_id === currentUserId || postAuthorId === currentUserId);

  return (
    <View style={[styles.row, isReply && styles.replyRow, comment.pending && styles.rowPending]}>
      <Pressable
        onPress={() => comment.user_id && onViewProfile(comment.user_id)}
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
              size={sz(12)}
              color="#1DA1F2"
              style={{ marginLeft: sz(3) }}
            />
          )}
          <Text style={styles.time}>{timeAgo(comment.created_at)}</Text>
        </View>

        <Text style={styles.text}>{comment.body}</Text>

        <View style={styles.actions}>
          {!comment.pending && (
            <Pressable
              // Replies stay one level deep: replying to a reply targets its thread.
              onPress={() => onReply(isReply && parentId ? ({ ...comment, id: parentId } as PostComment) : comment)}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={styles.actionText}>Reply</Text>
            </Pressable>
          )}
          {canDelete && !comment.pending && (
            <Pressable onPress={() => onDelete(comment, parentId)} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.actionText, { color: LIKE_RED }]}>Delete</Text>
            </Pressable>
          )}
          {comment.pending && <Text style={styles.actionText}>Sending…</Text>}
        </View>

        {!isReply && comment.replies_count > 0 && (
          <Pressable onPress={() => onToggleReplies(comment)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.repliesToggle}>
              {loadingReplies
                ? 'Loading replies…'
                : expanded
                  ? 'Hide replies'
                  : `View ${comment.replies_count} ${comment.replies_count === 1 ? 'reply' : 'replies'}`}
            </Text>
          </Pressable>
        )}

        {!isReply &&
          expanded &&
          (replies || []).map((r) => (
            <CommentRow
              key={r.id}
              comment={r as Pending}
              isReply
              parentId={comment.id}
              currentUserId={currentUserId}
              postAuthorId={postAuthorId}
              onViewProfile={onViewProfile}
              onReply={onReply}
              onDelete={onDelete}
              onToggleLike={onToggleLike}
              onToggleReplies={onToggleReplies}
            />
          ))}
      </View>

      {!comment.pending && (
        <Pressable
          onPress={() => onToggleLike(comment, parentId)}
          hitSlop={10}
          style={styles.likeBtn}
          accessibilityRole="button"
          accessibilityLabel={comment.liked_by_me ? 'Unlike comment' : 'Like comment'}
          accessibilityState={{ selected: !!comment.liked_by_me }}
        >
          <Ionicons
            name={comment.liked_by_me ? 'heart' : 'heart-outline'}
            size={sz(15)}
            color={comment.liked_by_me ? LIKE_RED : MUTED}
          />
          {comment.likes_count > 0 && <Text style={styles.likeCount}>{comment.likes_count}</Text>}
        </Pressable>
      )}
    </View>
  );
});

/**
 * The draft lives here, not in the sheet, so each keystroke re-renders this
 * box and not the comment list above it.
 */
function Composer({
  inputRef,
  replyTo,
  hasError,
  onClearError,
  onCancelReply,
  onSubmit,
}: {
  inputRef: React.RefObject<TextInput | null>;
  replyTo: PostComment | null;
  hasError: boolean;
  onClearError: () => void;
  onCancelReply: () => void;
  onSubmit: (body: string) => Promise<boolean>;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const disabled = !draft.trim() || sending;

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setDraft('');
    setSending(true);
    const ok = await onSubmit(body);
    // Put the text back rather than lose what the person typed, unless they
    // have already started typing something new.
    if (!ok) setDraft((current) => current || body);
    setSending(false);
  };

  return (
    <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, sz(10)) }]}>
      {replyTo && (
        <View style={styles.replyBanner}>
          <Text style={styles.replyBannerText} numberOfLines={1}>
            Replying to {replyTo.author_name || 'someone'}
          </Text>
          <Pressable onPress={onCancelReply} hitSlop={8} accessibilityLabel="Cancel reply">
            <Ionicons name="close" size={sz(15)} color={MUTED} />
          </Pressable>
        </View>
      )}
      <View style={styles.composerRow}>
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            if (hasError) onClearError();
          }}
          placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
          placeholderTextColor={MUTED}
          style={styles.input}
          multiline
          maxLength={2200}
          accessibilityLabel="Comment text"
        />
        <Pressable
          onPress={send}
          disabled={disabled}
          hitSlop={8}
          style={({ pressed }) => [
            styles.postBtn,
            disabled && styles.postBtnOff,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Post comment"
          accessibilityState={{ disabled }}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={styles.postBtnText}>Post</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/** Matches the real row's shape so the list does not jump when data lands. */
function CommentSkeletons() {
  return (
    <View style={{ paddingTop: sz(6) }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.row}>
          <View style={[styles.avatar, styles.skeleton]} />
          <View style={styles.body}>
            <View style={[styles.skeleton, styles.skelLine, { width: sz(96) }]} />
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
    borderTopLeftRadius: sz(20),
    borderTopRightRadius: sz(20),
    overflow: 'hidden',
  },
  grabArea: { paddingTop: sz(8) },
  grabber: {
    alignSelf: 'center',
    width: sz(38),
    height: sz(4),
    borderRadius: sz(2),
    backgroundColor: BORDER,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sz(16),
    paddingVertical: sz(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  title: { color: TEXT, fontSize: sz(16), fontWeight: '600' },

  row: { flexDirection: 'row', paddingHorizontal: sz(16), paddingVertical: sz(10) },
  replyRow: { paddingHorizontal: 0, paddingRight: 0, paddingTop: sz(10), paddingBottom: sz(2) },
  rowPending: { opacity: 0.55 },
  avatar: { width: sz(34), height: sz(34), borderRadius: sz(17), backgroundColor: BORDER },
  avatarSmall: { width: sz(26), height: sz(26), borderRadius: sz(13) },
  body: { flex: 1, marginLeft: sz(10) },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { color: TEXT, fontSize: sz(13), fontWeight: '600', flexShrink: 1 },
  time: { color: MUTED, fontSize: sz(11), marginLeft: sz(8) },
  text: { color: TEXT, fontSize: sz(14), lineHeight: sz(19), marginTop: sz(2) },
  actions: { flexDirection: 'row', gap: sz(16), marginTop: sz(5) },
  actionText: { color: MUTED, fontSize: sz(12), fontWeight: '600' },
  repliesToggle: { color: MUTED, fontSize: sz(12), fontWeight: '600', marginTop: sz(8) },

  likeBtn: { alignItems: 'center', paddingLeft: sz(10), paddingTop: sz(2), minWidth: sz(26) },
  likeCount: { color: MUTED, fontSize: sz(11), marginTop: sz(2) },

  center: { alignItems: 'center', justifyContent: 'center', flex: 1, padding: sz(32), gap: sz(6) },
  emptyTitle: { color: TEXT, fontSize: sz(15), fontWeight: '600', marginTop: sz(8), textAlign: 'center' },
  emptyBody: { color: MUTED, fontSize: sz(13), textAlign: 'center' },
  retry: {
    marginTop: sz(12),
    paddingHorizontal: sz(18),
    paddingVertical: sz(9),
    borderRadius: sz(10),
    borderWidth: 1,
    borderColor: BORDER,
  },
  retryText: { color: TEXT, fontSize: sz(13), fontWeight: '600' },

  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
    paddingHorizontal: sz(12),
    paddingTop: sz(10),
    backgroundColor: SURFACE,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sz(4),
    paddingBottom: sz(8),
  },
  replyBannerText: { color: MUTED, fontSize: sz(12), flexShrink: 1 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: sz(8) },
  input: {
    flex: 1,
    color: TEXT,
    fontSize: sz(14),
    maxHeight: sz(110),
    minHeight: sz(40),
    paddingHorizontal: sz(14),
    paddingTop: Platform.OS === 'ios' ? sz(11) : sz(8),
    paddingBottom: Platform.OS === 'ios' ? sz(11) : sz(8),
    borderRadius: sz(20),
    backgroundColor: '#1F1F1F',
  },
  postBtn: {
    backgroundColor: ACCENT,
    paddingHorizontal: sz(16),
    height: sz(40),
    borderRadius: sz(20),
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: sz(62),
  },
  // Dimmed, not greyed: white on this orange still clears AA at 14px semibold.
  postBtnOff: { opacity: 0.4 },
  postBtnText: { color: '#FFF', fontSize: sz(14), fontWeight: '700' },
  pressed: { opacity: 0.7 },

  skeleton: { backgroundColor: '#1F1F1F', borderRadius: sz(6) },
  skelLine: { height: sz(10), marginTop: sz(7) },
});
