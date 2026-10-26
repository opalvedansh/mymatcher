// Turns whatever a user pastes for a platform account (a bare name, "@name",
// a profile link, a mobile link) into one canonical handle the fetchers use.
// Returns null when the input can't be an account on that platform.

const lower = (s) => s.toLowerCase();

/** Host (without www./m.) and path segments, or null when it isn't a link. */
function parseLink(raw) {
  // "asha.travels" is a handle, not a site: only a scheme or a path makes a link.
  if ((!/^https?:\/\//i.test(raw) && !raw.includes('/')) || /\s/.test(raw)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^(www|m|mobile|open)\./, '');
    if (!host.includes('.')) return null;
    return { host, segments: url.pathname.split('/').filter(Boolean).map(decodeURIComponent), url };
  } catch {
    return null;
  }
}

/**
 * A username taken from a bare value or from the first path segment of a link
 * on one of `hosts`. `prefix` strips a leading marker such as "@" or "u/".
 */
function username(raw, hosts, pattern, { prefix = /^@/, segmentIndex = 0, skip = 0 } = {}) {
  const link = parseLink(raw);
  let name;
  if (link) {
    if (!hosts.includes(link.host)) return null;
    name = link.segments[segmentIndex + skip];
  } else {
    name = raw;
  }
  if (!name) return null;
  name = name.replace(prefix, '');
  return pattern.test(name) ? name : null;
}

const NORMALIZERS = {
  instagram: (raw) => {
    const name = username(raw, ['instagram.com'], /^[A-Za-z0-9._]{1,30}$/);
    return name && lower(name);
  },
  tiktok: (raw) => {
    const name = username(raw, ['tiktok.com'], /^[A-Za-z0-9._]{2,24}$/);
    return name && lower(name);
  },
  x: (raw) => {
    const name = username(raw, ['x.com', 'twitter.com'], /^[A-Za-z0-9_]{1,15}$/);
    if (!name || ['home', 'i', 'intent', 'search', 'explore', 'settings'].includes(lower(name))) return null;
    return lower(name);
  },
  threads: (raw) => {
    const name = username(raw, ['threads.net', 'threads.com'], /^[A-Za-z0-9._]{1,30}$/);
    return name && lower(name);
  },
  pinterest: (raw) => {
    const link = parseLink(raw);
    const hosts = ['pinterest.com', 'in.pinterest.com'];
    if (link && !hosts.includes(link.host) && !/^([a-z]{2}\.)?pinterest\.[a-z.]+$/.test(link.host)) return null;
    const name = link ? link.segments[0] : raw.replace(/^@/, '');
    return name && /^[A-Za-z0-9_]{3,30}$/.test(name) ? lower(name) : null;
  },
  reddit: (raw) => {
    const link = parseLink(raw);
    let name = raw;
    if (link) {
      if (!['reddit.com', 'old.reddit.com', 'new.reddit.com'].includes(link.host)) return null;
      if (!['user', 'u'].includes(link.segments[0])) return null;
      name = link.segments[1];
    }
    name = (name || '').replace(/^\/?u\//i, '').replace(/^@/, '');
    return /^[A-Za-z0-9_-]{3,20}$/.test(name) ? lower(name) : null;
  },
  twitch: (raw) => {
    const name = username(raw, ['twitch.tv'], /^[A-Za-z0-9_]{3,25}$/);
    return name && lower(name);
  },
  snapchat: (raw) => {
    const link = parseLink(raw);
    let name = raw.replace(/^@/, '');
    if (link) {
      if (link.host !== 'snapchat.com') return null;
      name = link.segments[0] === 'add' ? link.segments[1] : link.segments[0] === '@' ? link.segments[1] : (link.segments[0] || '').replace(/^@/, '');
    }
    return name && /^[A-Za-z][A-Za-z0-9._-]{2,14}$/.test(name) ? lower(name) : null;
  },
  behance: (raw) => {
    const name = username(raw, ['behance.net'], /^[A-Za-z0-9_-]{3,30}$/);
    return name && lower(name);
  },
  dribbble: (raw) => {
    const name = username(raw, ['dribbble.com'], /^[A-Za-z0-9_-]{2,30}$/);
    return name && lower(name);
  },
  discord: (raw) => {
    const link = parseLink(raw);
    let code = raw;
    if (link) {
      if (link.host === 'discord.gg') code = link.segments[0];
      else if (['discord.com', 'discordapp.com'].includes(link.host) && link.segments[0] === 'invite') code = link.segments[1];
      else return null;
    }
    return code && /^[A-Za-z0-9-]{2,32}$/.test(code) ? code : null; // invite codes are case-sensitive
  },
  spotify: (raw) => {
    const link = parseLink(raw);
    let id = raw.replace(/^spotify:artist:/, '');
    if (link) {
      if (link.host !== 'spotify.com') return null;
      // Locale prefixes: open.spotify.com/intl-in/artist/<id>
      const at = link.segments.indexOf('artist');
      if (at === -1) return null;
      id = link.segments[at + 1];
    }
    return id && /^[A-Za-z0-9]{22}$/.test(id) ? id : null; // ids are case-sensitive
  },
  youtube: (raw) => {
    const link = parseLink(raw);
    if (!link) {
      if (/^UC[A-Za-z0-9_-]{22}$/.test(raw)) return `channel/${raw}`;
      const name = raw.replace(/^@/, '');
      return /^[A-Za-z0-9._-]{3,30}$/.test(name) ? `@${lower(name)}` : null;
    }
    if (link.host !== 'youtube.com') return null;
    const [first, second] = link.segments;
    if (first?.startsWith('@') && /^@[A-Za-z0-9._-]{3,30}$/.test(first)) return lower(first);
    if (first === 'channel' && /^UC[A-Za-z0-9_-]{22}$/.test(second || '')) return `channel/${second}`;
    if ((first === 'c' || first === 'user') && /^[A-Za-z0-9._-]{1,100}$/.test(second || '')) return `${first}/${second}`;
    return null;
  },
  facebook: (raw) => {
    const link = parseLink(raw);
    if (!link) return /^[A-Za-z0-9.]{5,50}$/.test(raw) ? lower(raw) : null;
    if (!['facebook.com', 'fb.com', 'web.facebook.com'].includes(link.host)) return null;
    if (link.segments[0] === 'profile.php') {
      const id = link.url.searchParams.get('id');
      return id && /^\d{5,20}$/.test(id) ? `profile.php?id=${id}` : null;
    }
    const name = link.segments[0] === 'pages' ? link.segments[link.segments.length - 1] : link.segments[0];
    return name && /^[A-Za-z0-9.-]{3,80}$/.test(name) ? lower(name) : null;
  },
  linkedin: (raw, role) => {
    const link = parseLink(raw);
    if (!link) {
      const slug = raw.replace(/^@/, '');
      if (!/^[A-Za-z0-9_-]{2,100}$/.test(slug)) return null;
      // A brand's LinkedIn is a company page; a creator's is a personal one.
      return `${role === 'brand' ? 'company' : 'in'}/${lower(slug)}`;
    }
    if (link.host !== 'linkedin.com' && !link.host.endsWith('.linkedin.com')) return null;
    const [kind, slug] = link.segments;
    if (!['in', 'company'].includes(kind) || !/^[A-Za-z0-9_%-]{2,100}$/.test(slug || '')) return null;
    return `${kind}/${lower(slug)}`;
  },
};
NORMALIZERS.twitter = NORMALIZERS.x;

/** Platforms the server can fetch follower counts for. */
const FETCHABLE_PLATFORMS = Object.keys(NORMALIZERS);

/**
 * @param {string} platform  a platform id such as "youtube"
 * @param {unknown} raw      what the user typed
 * @param {'brand'|'influencer'} role
 * @returns {string|null}
 */
function normalizeHandle(platform, raw, role) {
  const normalize = NORMALIZERS[platform];
  if (!normalize || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 300) return null;
  return normalize(trimmed, role);
}

module.exports = { normalizeHandle, FETCHABLE_PLATFORMS };
