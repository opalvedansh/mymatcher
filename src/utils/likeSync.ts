import api from '@/api/client';

/**
 * Keeps a post's like on the server in step with rapid taps. The heart flips
 * on every tap, but requests for a post go out one at a time: when one lands,
 * the newest tap is sent if it differs from what the server now has. Firing a
 * request per tap let a slow "like" land after a quick "unlike", leaving the
 * server opposite to the screen.
 *
 * Shared across screens, so the feed and the post screen queue together.
 */
const wanted = new Map<string, boolean>();
const rollbacks = new Map<string, (liked: boolean) => void>();
const busy = new Set<string>();

/**
 * `serverLiked` is the state before this tap. `onFail` gets the state the
 * server actually holds when the final request fails, to put the heart back.
 */
export function syncLike(postId: string, serverLiked: boolean, liked: boolean, onFail: (liked: boolean) => void) {
  wanted.set(postId, liked);
  rollbacks.set(postId, onFail);
  if (busy.has(postId)) return;
  drain(postId, serverLiked);
}

async function drain(postId: string, confirmed: boolean) {
  busy.add(postId);
  try {
    while (wanted.get(postId) !== confirmed) {
      const target = wanted.get(postId)!;
      try {
        await api.post(`/api/posts/${postId}/like`, { liked: target });
        confirmed = target;
      } catch {
        rollbacks.get(postId)?.(confirmed);
        return;
      }
    }
  } finally {
    busy.delete(postId);
    wanted.delete(postId);
    rollbacks.delete(postId);
  }
}
