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
  return api.get<AnyProfile>(`/api/profiles/${userId}`);
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

export function getFeedStories() {
  return api.get('/api/stories/feed');
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
