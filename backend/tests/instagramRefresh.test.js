jest.mock('../src/config/db', () => ({ query: jest.fn() }));
jest.mock('../src/middleware/cacheMiddleware', () => ({ invalidateCache: jest.fn().mockResolvedValue() }));
jest.mock('../src/services/instagramSyncService', () => ({ scrapeInstagramProfiles: jest.fn() }));

const db = require('../src/config/db');
const { invalidateCache } = require('../src/middleware/cacheMiddleware');
const { scrapeInstagramProfiles } = require('../src/services/instagramSyncService');
const { refreshStaleInstagramStats } = require('../src/services/instagramRefresh');

const stats = (followers) => ({ followers, engagement_rate: 2.5, avg_views: 1000, reels: [] });

beforeEach(() => jest.clearAllMocks());

test('updates stale creators with fresh stats and clears their cached profile', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [
      { user_id: 'u1', instagram_handle: '@Alice' },
      { user_id: 'u2', instagram_handle: 'bob' },
    ] })
    .mockResolvedValue({ rowCount: 1 });
  scrapeInstagramProfiles.mockResolvedValue(new Map([['alice', stats(12000)], ['bob', stats(800)]]));

  await expect(refreshStaleInstagramStats()).resolves.toEqual({ checked: 2, updated: 2 });

  // Handles are cleaned for the scraper but matched as stored.
  expect(scrapeInstagramProfiles).toHaveBeenCalledWith(['alice', 'bob']);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE influencer_profiles'),
    [12000, 2.5, 1000, 'u1', '@Alice']);
  expect(invalidateCache).toHaveBeenCalledWith('cache:/api/profiles/u1');
  expect(invalidateCache).toHaveBeenCalledWith('cache:/api/profiles/u2');
});

test('keeps last known stats for handles the scraper could not read', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ user_id: 'u1', instagram_handle: 'private.acct' }] });
  scrapeInstagramProfiles.mockResolvedValue(new Map());

  await expect(refreshStaleInstagramStats()).resolves.toEqual({ checked: 1, updated: 0 });
  expect(db.query).toHaveBeenCalledTimes(1);
  expect(invalidateCache).not.toHaveBeenCalled();
});

test('a failed scrape skips only its own batch', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ user_id: `u${i}`, instagram_handle: `h${i}` }));
  db.query.mockResolvedValueOnce({ rows }).mockResolvedValue({ rowCount: 1 });
  scrapeInstagramProfiles
    .mockRejectedValueOnce(new Error('actor timed out'))
    .mockResolvedValueOnce(new Map(rows.slice(25).map((r) => [r.instagram_handle, stats(5)])));

  await expect(refreshStaleInstagramStats()).resolves.toEqual({ checked: 30, updated: 5 });
  expect(scrapeInstagramProfiles).toHaveBeenCalledTimes(2);
});

test('does not count a creator who changed handle mid-run', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ user_id: 'u1', instagram_handle: 'old' }] })
    .mockResolvedValue({ rowCount: 0 });
  scrapeInstagramProfiles.mockResolvedValue(new Map([['old', stats(10)]]));

  await expect(refreshStaleInstagramStats()).resolves.toEqual({ checked: 1, updated: 0 });
  expect(invalidateCache).not.toHaveBeenCalled();
});
