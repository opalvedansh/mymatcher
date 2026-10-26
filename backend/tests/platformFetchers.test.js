jest.mock('../src/services/apifyClient', () => ({ runActor: jest.fn() }));
jest.mock('../src/services/instagramSyncService', () => ({ scrapeInstagramProfiles: jest.fn() }));

const { runActor } = require('../src/services/apifyClient');
const { scrapeInstagramProfiles } = require('../src/services/instagramSyncService');
const { FETCHERS, parseCount } = require('../src/services/platformStats/fetchers');

const page = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  json: async () => JSON.parse(body),
});

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

test('parseCount reads numbers and abbreviated counts', () => {
  expect(parseCount(12345)).toBe(12345);
  expect(parseCount('12,345')).toBe(12345);
  expect(parseCount('1.2M')).toBe(1200000);
  expect(parseCount('48K')).toBe(48000);
  expect(parseCount('n/a')).toBeNull();
  expect(parseCount(-1)).toBeNull();
});

describe('Apify fetchers', () => {
  it('matches a batch back to its handles by account name', async () => {
    runActor.mockResolvedValue([
      { type: 'user', userName: 'Bob', followers: 20 },
      { type: 'user', userName: 'alice', followers: 10 },
      { type: 'user', userName: 'someone_else', followers: 99 },
    ]);
    const counts = await FETCHERS.x.fetch(['alice', 'bob', 'missing']);
    expect(counts).toEqual(new Map([['bob', 20], ['alice', 10]]));
    expect(runActor).toHaveBeenCalledWith('apidojo/twitter-user-scraper',
      expect.objectContaining({ twitterHandles: ['alice', 'bob', 'missing'], getFollowers: false }), expect.any(Object));
  });

  it.each([
    ['tiktok', 'clockworks/tiktok-profile-scraper', 'asha', { authorMeta: { name: 'asha', fans: 852 } }, 852],
    ['youtube', 'streamers/youtube-channel-scraper', '@asha', { channelUsername: 'Asha', numberOfSubscribers: 8390 }, 8390],
    ['facebook', 'apify/facebook-pages-scraper', 'ashapage', { pageName: 'AshaPage', followers: 1219522 }, 1219522],
    ['threads', 'apify/threads-profile-api-scraper', 'asha', { username: 'asha', follower_count: 35766 }, 35766],
    ['pinterest', 'easyapi/pinterest-profile-scraper', 'asha', { username: 'asha', follower_count: 24056 }, 24056],
    ['reddit', 'harshmaur/reddit-user-scraper', 'asha', { dataType: 'user_profile', username: 'asha', followersCount: 128 }, 128],
    ['twitch', 'piotrv1001/twitch-channel-scraper', 'asha', { type: 'channel', login: 'asha', followers: 3048541 }, 3048541],
    ['spotify', 'khadinakbar/spotify-artist-scraper', '0TnOYISbd1XYRBk9myaseg',
      { type: 'artist', id: '0TnOYISbd1XYRBk9myaseg', followers: 9800000 }, 9800000],
  ])('%s reads its scraper\'s follower field', async (platform, actor, handle, item, expected) => {
    runActor.mockResolvedValue([item]);
    await expect(FETCHERS[platform].fetch([handle])).resolves.toEqual(new Map([[handle, expected]]));
    expect(runActor.mock.calls[0][0]).toBe(actor);
  });

  it('runs LinkedIn people and companies through their own scrapers', async () => {
    runActor.mockImplementation(async (actor) => actor === 'harvestapi/linkedin-company'
      ? [{ universalName: 'oreva', followerCount: 5000 }]
      : [{ publicIdentifier: 'asha-rao', followerCount: 264 }]);
    const counts = await FETCHERS.linkedin.fetch(['in/asha-rao', 'company/oreva']);
    expect(counts).toEqual(new Map([['in/asha-rao', 264], ['company/oreva', 5000]]));
  });

  it('reads a brand\'s Instagram through the Instagram scraper', async () => {
    scrapeInstagramProfiles.mockResolvedValue(new Map([['oreva', { followers: 4200 }]]));
    await expect(FETCHERS.instagram.fetch(['oreva', 'gone'])).resolves.toEqual(new Map([['oreva', 4200]]));
  });

  it('passes a failed scraper run up to the caller', async () => {
    runActor.mockRejectedValue(new Error('actor timed out'));
    await expect(FETCHERS.threads.fetch(['asha'])).rejects.toThrow('actor timed out');
  });
});

describe('direct fetchers', () => {
  it('reads a Discord invite\'s member count', async () => {
    global.fetch.mockResolvedValue(page(JSON.stringify({ approximate_member_count: 309322 })));
    await expect(FETCHERS.discord.fetch(['AbC123'])).resolves.toEqual(new Map([['AbC123', 309322]]));
    expect(global.fetch.mock.calls[0][0]).toContain('/invites/AbC123?with_counts=true');
  });

  it('reads Snapchat subscribers from the public profile data', async () => {
    const data = { props: { pageProps: { userProfile: { publicProfileInfo: { username: 'asha.snaps', subscriberCount: '28643700' } } } } };
    global.fetch.mockResolvedValue(page(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`));
    await expect(FETCHERS.snapchat.fetch(['asha.snaps'])).resolves.toEqual(new Map([['asha.snaps', 28643700]]));
  });

  it('reads the profile owner\'s Behance followers, not a related designer\'s', async () => {
    const state = { profile: { user: { username: 'ashadesigns', stats: { followers: 4704 } } } };
    global.fetch.mockResolvedValue(page(
      `"stats":{"followers":99999}<script type="application/json" id="beconfig-store_state">${JSON.stringify(state)}</script>`
    ));
    await expect(FETCHERS.behance.fetch(['ashadesigns'])).resolves.toEqual(new Map([['ashadesigns', 4704]]));
  });

  it('reads Dribbble followers from the about page', async () => {
    global.fetch.mockResolvedValue(page('<span class="count">19,115</span> <span class="label">followers</span>'));
    await expect(FETCHERS.dribbble.fetch(['asha'])).resolves.toEqual(new Map([['asha', 19115]]));
    expect(global.fetch.mock.calls[0][0]).toBe('https://dribbble.com/asha/about');
  });

  it('leaves out accounts that don\'t exist', async () => {
    global.fetch.mockResolvedValueOnce(page('', 404)).mockResolvedValueOnce(page('<span>5</span><span>followers</span>'));
    await expect(FETCHERS.dribbble.fetch(['gone', 'here'])).resolves.toEqual(new Map([['here', 5]]));
  });

  it('treats every read failing as the source blocking us', async () => {
    global.fetch.mockResolvedValue(page('blocked', 403));
    await expect(FETCHERS.behance.fetch(['a', 'b'])).rejects.toThrow('every direct read failed');
  });
});
