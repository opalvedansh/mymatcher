import type { PlatformFollowers } from '@/api/types';

/** 40000 → 40K. Never rounds a real number up into a bigger one. */
export const compactCount = (n: number) =>
  n >= 1_000_000 ? `${+(Math.floor(n / 100_000) / 10).toFixed(1)}M`
  : n >= 1000 ? `${Math.floor(n / 1000)}K`
  : String(n);

/** True when the server fetched this platform's count; users can't edit those. */
export const isSyncedCount = (followers: PlatformFollowers | undefined, platform: string) =>
  followers?.[platform]?.source === 'synced';

/** Text-field values for the follower editor, one per platform. */
export function followerDrafts(followers: PlatformFollowers | undefined, platforms: string[]) {
  const drafts: Record<string, string> = {};
  for (const p of platforms) {
    const count = followers?.[p]?.count;
    drafts[p] = count != null && !isSyncedCount(followers, p) ? String(count) : '';
  }
  return drafts;
}

/** The typed counts to save: every editable platform with a number filled in. */
export function typedFollowers(
  drafts: Record<string, string>,
  followers: PlatformFollowers | undefined,
  platforms: string[],
) {
  const typed: Record<string, number> = {};
  for (const p of platforms) {
    const text = drafts[p]?.trim();
    if (text && !isSyncedCount(followers, p)) typed[p] = Number(text);
  }
  return typed;
}

/** What to type in each platform's account field. */
export const HANDLE_PLACEHOLDERS: Record<string, string> = {
  instagram: '@username or profile link',
  youtube: '@handle or channel link',
  tiktok: '@username or profile link',
  x: '@username or profile link',
  twitter: '@username or profile link',
  threads: '@username or profile link',
  facebook: 'Page link',
  linkedin: 'Profile or company page link',
  pinterest: 'Username or profile link',
  reddit: 'u/username or profile link',
  snapchat: 'Username (public profile)',
  twitch: 'Channel name or link',
  spotify: 'Artist link',
  discord: 'Server invite link',
  behance: 'Username or profile link',
  dribbble: 'Username or profile link',
};

/** A stored (normalized) account shown the way people write it; the server reads it back. */
export function displayHandle(platform: string, handle: string | undefined) {
  if (!handle) return '';
  switch (platform) {
    case 'instagram': case 'tiktok': case 'x': case 'twitter': case 'threads': return `@${handle}`;
    case 'youtube': return handle.startsWith('@') ? handle : `youtube.com/${handle}`;
    case 'linkedin': return `linkedin.com/${handle}`;
    case 'facebook': return `facebook.com/${handle}`;
    case 'spotify': return `open.spotify.com/artist/${handle}`;
    case 'discord': return `discord.gg/${handle}`;
    case 'reddit': return `u/${handle}`;
    default: return handle;
  }
}

/** Account-field values for the follower editor, one per platform. */
export function handleDrafts(handles: Record<string, string> | undefined, platforms: string[]) {
  const drafts: Record<string, string> = {};
  for (const p of platforms) drafts[p] = displayHandle(p, handles?.[p]);
  return drafts;
}

/** The accounts to save: every listed platform with something typed in. */
export function typedHandles(drafts: Record<string, string>, platforms: string[]) {
  const handles: Record<string, string> = {};
  for (const p of platforms) {
    const text = drafts[p]?.trim();
    if (text) handles[p] = text;
  }
  return handles;
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', twitter: 'Twitter',
  reddit: 'Reddit', pinterest: 'Pinterest', facebook: 'Facebook', linkedin: 'LinkedIn',
  snapchat: 'Snapchat', threads: 'Threads', spotify: 'Spotify', twitch: 'Twitch',
  discord: 'Discord', behance: 'Behance', dribbble: 'Dribbble',
};

/** A platform id as people write it: youtube → YouTube. */
export const platformLabel = (p: string) => PLATFORM_LABELS[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
