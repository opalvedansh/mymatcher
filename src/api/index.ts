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
  ProfileUpdate,
  UserRole,
  ChatResponse,
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
  return api.get<MatchRecord[]>('/api/matches');
}

export function getMatchById(matchId: string) {
  return api.get<MatchRecord>(`/api/matches/${matchId}`);
}

export function archiveMatch(matchId: string) {
  return api.delete<{ message: string }>(`/api/matches/${matchId}`);
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

// ─── Maps ─────────────────────────────────────────────────────────

export function getMapAutocomplete(input: string, types: string = '(cities)') {
  return api.get<any>(`/api/maps/autocomplete?input=${encodeURIComponent(input)}&types=${encodeURIComponent(types)}`);
}

export function getMapGeocode(placeId: string) {
  return api.get<any>(`/api/maps/geocode?place_id=${encodeURIComponent(placeId)}`);
}
