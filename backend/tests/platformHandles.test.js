const { normalizeHandle, FETCHABLE_PLATFORMS } = require('../src/services/platformStats/handles');

describe('normalizeHandle', () => {
  it.each([
    ['instagram', 'https://www.instagram.com/Asha.Travels/?hl=en', 'asha.travels'],
    ['instagram', '@asha_travels', 'asha_travels'],
    ['tiktok', 'https://www.tiktok.com/@Asha.Eats', 'asha.eats'],
    ['x', 'https://x.com/AshaTravels', 'ashatravels'],
    ['x', 'twitter.com/asha_t', 'asha_t'],
    ['twitter', '@asha_t', 'asha_t'],
    ['threads', 'https://www.threads.net/@asha', 'asha'],
    ['pinterest', 'https://in.pinterest.com/ashapins/', 'ashapins'],
    ['reddit', 'https://www.reddit.com/user/Asha_R/', 'asha_r'],
    ['reddit', 'u/asha_r', 'asha_r'],
    ['twitch', 'https://www.twitch.tv/AshaLive', 'ashalive'],
    ['snapchat', 'https://www.snapchat.com/add/asha.snaps', 'asha.snaps'],
    ['snapchat', 'asha.snaps', 'asha.snaps'],
    ['behance', 'https://www.behance.net/ashadesigns', 'ashadesigns'],
    ['dribbble', 'dribbble.com/asha', 'asha'],
    ['discord', 'https://discord.gg/AbC123', 'AbC123'],
    ['discord', 'https://discord.com/invite/AbC123', 'AbC123'],
    ['spotify', 'https://open.spotify.com/intl-in/artist/0TnOYISbd1XYRBk9myaseg?si=x', '0TnOYISbd1XYRBk9myaseg'],
    ['youtube', 'https://www.youtube.com/@AshaTravels/videos', '@ashatravels'],
    ['youtube', '@AshaTravels', '@ashatravels'],
    ['youtube', 'https://youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw', 'channel/UC_x5XG1OV2P6uZZ5FSM9Ttw'],
    ['youtube', 'https://www.youtube.com/c/AshaTravels', 'c/AshaTravels'],
    ['facebook', 'https://www.facebook.com/AshaTravelsPage/', 'ashatravelspage'],
    ['facebook', 'https://www.facebook.com/profile.php?id=100077736131324', 'profile.php?id=100077736131324'],
    ['linkedin', 'https://www.linkedin.com/in/asha-rao-123/', 'in/asha-rao-123'],
    ['linkedin', 'https://in.linkedin.com/company/oreva', 'company/oreva'],
  ])('%s: %s → %s', (platform, raw, expected) => {
    expect(normalizeHandle(platform, raw, 'influencer')).toBe(expected);
  });

  it('reads a bare LinkedIn name as a company for brands and a person for creators', () => {
    expect(normalizeHandle('linkedin', 'oreva', 'brand')).toBe('company/oreva');
    expect(normalizeHandle('linkedin', 'asha-rao', 'influencer')).toBe('in/asha-rao');
  });

  it.each([
    ['youtube', 'https://www.tiktok.com/@asha'], // another platform's link
    ['x', 'https://x.com/home'],
    ['spotify', 'https://open.spotify.com/show/0TnOYISbd1XYRBk9myaseg'], // podcasts aren't artists
    ['discord', 'https://discord.com/channels/123/456'],
    ['reddit', 'https://www.reddit.com/r/india'], // a subreddit, not a user
    ['instagram', 'not a handle at all'],
    ['instagram', ''],
    ['unknownplatform', 'asha'],
  ])('rejects %s: %s', (platform, raw) => {
    expect(normalizeHandle(platform, raw, 'influencer')).toBeNull();
  });

  it('covers every platform the app offers', () => {
    const appPlatforms = ['instagram', 'youtube', 'tiktok', 'x', 'twitter', 'reddit', 'pinterest', 'facebook',
      'linkedin', 'snapchat', 'threads', 'spotify', 'twitch', 'discord', 'behance', 'dribbble'];
    expect(FETCHABLE_PLATFORMS.sort()).toEqual(appPlatforms.sort());
  });
});

test('a bare handle with a dot is a handle, not a link', () => {
  expect(normalizeHandle('instagram', 'asha.travels', 'influencer')).toBe('asha.travels');
  expect(normalizeHandle('threads', 'asha.t', 'influencer')).toBe('asha.t');
});
