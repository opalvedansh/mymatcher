import { Platform, Share } from 'react-native';
import { recordPostShare } from '@/api';
import type { Post } from '@/components/PostCard';

/**
 * Sharing a post.
 *
 * The link points at the backend share page rather than a `matchr://` deep
 * link: a custom scheme is not tappable in WhatsApp or iMessage and shows no
 * preview, so it only ever works for people who already have the app. The
 * https URL unfurls with the post image and routes into the app through
 * Universal Links / App Links when the app is installed.
 */
const SHARE_BASE = (
  process.env.EXPO_PUBLIC_SHARE_URL ||
  process.env.EXPO_PUBLIC_API_URL ||
  'https://api.mymatchr.in'
).replace(/\/$/, '');

export function postShareUrl(postId: string): string {
  return `${SHARE_BASE}/p/${postId}`;
}

/**
 * Opens the OS share sheet and records the share when it completes.
 *
 * @returns the new share count when one came back, otherwise null.
 */
export async function sharePost(post: Pick<Post, 'id' | 'caption' | 'author_name'>): Promise<number | null> {
  const url = postShareUrl(post.id);
  const author = post.author_name || 'a creator';
  const caption = post.caption?.trim();
  const blurb = caption || `See ${author}'s post on Matchr`;

  try {
    // iOS renders `url` as its own rich attachment; Android has no url field,
    // so the link has to ride along inside the message.
    const result =
      Platform.OS === 'ios'
        ? await Share.share({ message: blurb, url })
        : await Share.share({ message: `${blurb}\n${url}` });

    if (result.action !== Share.sharedAction) return null;

    // Recorded only on a completed share, so a sheet the user backs out of
    // does not inflate the count or the ranking signal.
    const { shares_count } = await recordPostShare(post.id, 'app');
    return shares_count;
  } catch {
    // A failed share or a failed record is not worth interrupting anyone over.
    return null;
  }
}
