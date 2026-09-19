/**
 * Matcherc API — typed endpoint functions
 *
 * Import and use these in screens/components:
 *   import { getFeed, recordSwipe, getMatches } from '@/api';
 */

import api from './client';
import type {
  ApiUser,
  AnyProfile,
  FeedResponse,
  SwipeDirection,
  SwipeResponse,
  SwipeRecord,
  MatchRecord,
  MatchListResponse,
  MatchStats,
  ProfileUpdate,
  Responsiveness,
  BrandRating,
  VerificationRequestResult,
  UserRole,
  ChatResponse,
  NotificationsResponse,
} from './types';
import type { Post } from '@/components/PostCard';

// ─── Upload ───────────────────────────────────────────────────────

export async function uploadImage(uri: string): Promise<string> {
  try {
    // Get file info
    const response = await fetch(uri);
    const blob = await response.blob();
    const contentType = blob.type || 'image/jpeg';
    const ext = contentType.split('/')[1] || 'jpg';
    const filename = `upload.${ext}`;

    // Get presigned URL
    const data = await api.post<{ signedUrl: string; publicUrl: string }>('/api/upload/presigned-url', {
      filename,
      contentType
    });

    // Upload to Supabase Storage
    const uploadResponse = await fetch(data.signedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: blob,
    });
    if (!uploadResponse.ok) {
      throw new Error(`Image upload failed (HTTP ${uploadResponse.status})`);
    }

    return data.publicUrl;
  } catch (error) {
    console.error('Failed to upload image:', error);
    throw error;
  }
}

// ─── Auth ─────────────────────────────────────────────────────────

/**
 * Syncs the Firebase-authenticated user into PostgreSQL.
 * Call this immediately after sign-up and after onboarding role selection.
 */
export function syncUser(role?: UserRole) {
  return api.post<{ user: ApiUser }>('/api/auth/sync', role ? { role } : {});
}

export function getMe() {
  return api.get<ApiUser>('/api/auth/me');
}

// ─── Profile ──────────────────────────────────────────────────────

export function getMyProfile() {
  return api.get<AnyProfile>('/api/profiles/me');
}

export function verifyFace(base64Image: string) {
  return api.post<{ success: boolean; message: string; similarity: number }>('/api/profiles/verify-face', { base64Image });
}

export function updateMyProfile(data: ProfileUpdate) {
  return api.put<AnyProfile>('/api/profiles/me', data);
}

/** How quickly you reply to matches, worked out from your own chat history. */
export function getMyResponsiveness() {
  return api.get<Responsiveness>('/api/profiles/me/responsiveness');
}

/** Asks an admin to verify this brand as a business. Does not grant the badge. */
export function requestVerification(business_name: string, reg_number: string) {
  return api.post<VerificationRequestResult>('/api/profiles/me/verification', { business_name, reg_number });
}

export function getProfileById(userId: string) {
  // Someone else's profile is opened repeatedly while swiping and from chat,
  // and changes rarely. The server already caches this route for 300s, so a
  // short client TTL only removes a round-trip that was returning the same
  // body anyway. Any mutation from this device clears it (see api/client).
  return api.get<AnyProfile>(`/api/profiles/${userId}`, { ttlMs: 60_000 });
}

export function syncInstagram(instagram_handle: string) {
  return api.post<AnyProfile>('/api/profiles/sync-instagram', { instagram_handle });
}

// ─── Feed ─────────────────────────────────────────────────────────

/**
 * Returns the next batch of swipe candidates for the current user.
 * @param limit  How many to load (max 50)
 * @param offset Pagination offset
 */
export function getFeed(limit = 10, cursorScore?: number, cursorId?: string) {
  let url = `/api/feed?limit=${limit}`;
  if (cursorScore !== undefined && cursorScore !== null) url += `&cursor_score=${cursorScore}`;
  if (cursorId) url += `&cursor_id=${cursorId}`;
  return api.get<FeedResponse>(url);
}

// ─── Swipes ───────────────────────────────────────────────────────

/**
 * Records a swipe. Returns whether a mutual match was created.
 */
export function recordSwipe(swiped_id: string, direction: SwipeDirection) {
  return api.post<SwipeResponse>('/api/swipes', { swiped_id, direction });
}

export function getMySwipes() {
  return api.get<SwipeRecord[]>('/api/swipes');
}

export function getLikesReceived() {
  return api.get('/api/swipes/received');
}

// ─── Matches ──────────────────────────────────────────────────────

export function getMatches() {
  return api.get<MatchListResponse>('/api/matches');
}

/** Totals across every match, so counts stay right past the 50-row page getMatches returns. */
export function getMatchStats() {
  return api.get<MatchStats>('/api/matches/stats');
}

export function getMatchById(matchId: string) {
  return api.get<MatchRecord>(`/api/matches/${matchId}`);
}

export function archiveMatch(matchId: string) {
  return api.delete<{ message: string }>(`/api/matches/${matchId}`);
}

// ─── Brand ratings ────────────────────────────────────────────────

export function getBrandRating(brandId: string) {
  return api.get<BrandRating>(`/api/ratings/${encodeURIComponent(brandId)}`);
}

/** Only a creator who matched with the brand may rate it; 1 to 5. */
export function rateBrand(brandId: string, score: number) {
  return api.put<BrandRating>(`/api/ratings/${encodeURIComponent(brandId)}`, { score });
}

export function removeBrandRating(brandId: string) {
  return api.delete<{ removed: number }>(`/api/ratings/${encodeURIComponent(brandId)}`);
}

// ─── Chat ─────────────────────────────────────────────────────────

export function getMessages(matchId: string, limit = 50, cursor?: string) {
  const url = cursor 
    ? `/api/chat/${matchId}/messages?limit=${limit}&cursor=${cursor}`
    : `/api/chat/${matchId}/messages?limit=${limit}`;
  return api.get<ChatResponse>(url);
}

// ─── Stories ──────────────────────────────────────────────────────

export function uploadStory(media_url: string) {
  return api.post('/api/stories', { media_url });
}

/**
 * Both home screens fetch this on every mount, and stories only change when
 * someone posts one. Posting from this device goes through api.post, which
 * clears the cache, so the author still sees their own story immediately.
 * Pull-to-refresh passes `force` so the gesture always hits the network.
 */
export function getFeedStories(force = false) {
  return api.get('/api/stories/feed', { ttlMs: 30_000, force });
}

export function recordStoryView(storyId: string) {
  return api.post(`/api/stories/${storyId}/view`, {});
}

export function getStoryViewers(storyId: string) {
  return api.get<any[]>(`/api/stories/${storyId}/viewers`);
}

// ─── Trust & safety ───────────────────────────────────────────────

export type ReportTargetType = 'user' | 'post' | 'story' | 'message';
export type ReportReason = 'spam' | 'inappropriate' | 'harassment' | 'fake_profile' | 'other';

export function blockUser(userId: string) {
  return api.post('/api/blocks', { user_id: userId });
}

export function unblockUser(userId: string) {
  return api.delete(`/api/blocks/${encodeURIComponent(userId)}`);
}

export function reportContent(targetType: ReportTargetType, targetId: string, reason: ReportReason, details?: string) {
  return api.post('/api/reports', { target_type: targetType, target_id: targetId, reason, details });
}

export function deleteMyAccount() {
  return api.delete<{ deleted: boolean }>('/api/account');
}

// ─── Notifications ────────────────────────────────────────────────

export function getNotifications(limit = 30, before?: string) {
  const url = before
    ? `/api/notifications?limit=${limit}&before=${encodeURIComponent(before)}`
    : `/api/notifications?limit=${limit}`;
  return api.get<NotificationsResponse>(url);
}

export function getUnreadNotificationCount() {
  return api.get<{ count: number }>('/api/notifications/unread-count');
}

/** Marks the given notifications read, or all of them when `ids` is omitted. */
export function markNotificationsRead(ids?: string[]) {
  return api.post<{ updated: number }>('/api/notifications/read', ids ? { ids } : {});
}

// ─── Maps ─────────────────────────────────────────────────────────

export function getMapAutocomplete(input: string, types: string = '(cities)') {
  return api.get<any>(`/api/maps/autocomplete?input=${encodeURIComponent(input)}&types=${encodeURIComponent(types)}`);
}

export function getMapGeocode(placeId: string) {
  return api.get<any>(`/api/maps/geocode?place_id=${encodeURIComponent(placeId)}`);
}

// ─── Posts: feed, comments and shares ─────────────────────────────

export interface PostComment {
  id: string;
  post_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  likes_count: number;
  replies_count: number;
  edited_at: string | null;
  created_at: string;
  author_name?: string | null;
  author_avatar?: string | null;
  author_verified?: boolean;
  liked_by_me?: boolean;
}

/**
 * One page of the ranked feed. Pass the previous page's `next_cursor` to
 * continue; omit it to start over, which also rebuilds the ranking and is
 * what pull-to-refresh should do.
 */
export function getPostFeed(limit = 20, cursor?: string | null) {
  const url = cursor
    ? `/api/posts/feed?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
    : `/api/posts/feed?limit=${limit}`;
  return api.get<{ posts: Post[]; next_cursor: string | null }>(url);
}

export function getPost(postId: string) {
  return api.get<{ post: Post }>(`/api/posts/${postId}`);
}

export function getPostComments(postId: string, limit = 20, before?: string | null) {
  const url = before
    ? `/api/posts/${postId}/comments?limit=${limit}&before=${encodeURIComponent(before)}`
    : `/api/posts/${postId}/comments?limit=${limit}`;
  return api.get<{ comments: PostComment[]; next_before: string | null }>(url);
}

export function getCommentReplies(postId: string, commentId: string, limit = 20, after?: string | null) {
  const url = after
    ? `/api/posts/${postId}/comments/${commentId}/replies?limit=${limit}&after=${encodeURIComponent(after)}`
    : `/api/posts/${postId}/comments/${commentId}/replies?limit=${limit}`;
  return api.get<{ replies: PostComment[]; next_after: string | null }>(url);
}

export function createPostComment(postId: string, body: string, parentId?: string | null) {
  return api.post<{ comment: PostComment }>(`/api/posts/${postId}/comments`, {
    body,
    parent_id: parentId ?? null,
  });
}

export function deletePostComment(postId: string, commentId: string) {
  return api.delete<{ success: boolean }>(`/api/posts/${postId}/comments/${commentId}`);
}

export function likePostComment(postId: string, commentId: string, liked: boolean) {
  return api.post<{ liked: boolean; likes_count: number }>(
    `/api/posts/${postId}/comments/${commentId}/like`,
    { liked }
  );
}

/** Records that a share sheet was opened. Best effort: never block the share. */
export function recordPostShare(postId: string, channel: 'app' | 'link' | 'web' = 'app') {
  return api.post<{ shares_count: number }>(`/api/posts/${postId}/share`, { channel });
}
