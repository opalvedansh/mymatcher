jest.mock('../src/config/db', () => ({ query: jest.fn() }));
jest.mock('../src/middleware/cacheMiddleware', () => ({ invalidateCache: jest.fn().mockResolvedValue() }));
jest.mock('../src/services/platformStats/fetchers', () => ({
  FETCHERS: {
    youtube: { batchSize: 1, fetch: jest.fn() },
    x: { batchSize: 25, fetch: jest.fn() },
    instagram: { batchSize: 25, fetch: jest.fn() },
  },
}));

const db = require('../src/config/db');
const sharedCache = require('../src/utils/sharedCache');
const { invalidateCache } = require('../src/middleware/cacheMiddleware');
const { FETCHERS } = require('../src/services/platformStats/fetchers');
const { syncUserPlatforms, refreshStalePlatformStats, needsSync } = require('../src/services/platformStats');

beforeEach(() => {
  jest.clearAllMocks();
  sharedCache._local.clear?.();
});

const updates = () => db.query.mock.calls.filter(([sql]) => sql.includes('UPDATE'));

test('needsSync is true until a count was fetched for this exact handle', () => {
  expect(needsSync(undefined, 'a')).toBe(true);
  expect(needsSync({ source: 'self', count: 5 }, 'a')).toBe(true);
  expect(needsSync({ source: 'synced', handle: 'old' }, 'a')).toBe(true);
  expect(needsSync({ source: 'synced', handle: 'a' }, 'a')).toBe(false);
});

describe('syncUserPlatforms', () => {
  it('fetches only new or changed accounts and stores them as synced', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{
        platform_handles: { x: 'asha', youtube: '@asha', instagram: 'asha' },
        platform_followers: { youtube: { source: 'synced', handle: '@asha', count: 9 } },
      }] })
      .mockResolvedValue({ rowCount: 1 });
    FETCHERS.x.fetch.mockResolvedValue(new Map([['asha', 870]]));

    await expect(syncUserPlatforms('u1', 'influencer')).resolves.toEqual({ checked: 1, updated: 1 });

    expect(FETCHERS.youtube.fetch).not.toHaveBeenCalled(); // already synced for this handle
    expect(FETCHERS.instagram.fetch).not.toHaveBeenCalled(); // a creator's Instagram has its own sync
    const [sql, params] = updates()[0];
    expect(sql).toContain('influencer_profiles');
    expect(params[0]).toBe('u1');
    expect(params[1]).toBe('x');
    expect(JSON.parse(params[2])).toMatchObject({ count: 870, source: 'synced', handle: 'asha' });
    expect(params[3]).toBe('asha'); // only while the profile still lists this handle
    expect(invalidateCache).toHaveBeenCalledWith('cache:/api/profiles/u1');
  });

  it('does not retry a handle within the hour, so repeated saves cost nothing', async () => {
    const row = { rows: [{ platform_handles: { x: 'asha' }, platform_followers: {} }] };
    db.query.mockResolvedValueOnce(row).mockResolvedValueOnce(row);
    FETCHERS.x.fetch.mockResolvedValue(new Map()); // account unreadable

    await syncUserPlatforms('u2', 'brand');
    await syncUserPlatforms('u2', 'brand');
    expect(FETCHERS.x.fetch).toHaveBeenCalledTimes(1);
  });

  it('fetches a brand\'s Instagram', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ platform_handles: { instagram: 'oreva' }, platform_followers: {} }] })
      .mockResolvedValue({ rowCount: 1 });
    FETCHERS.instagram.fetch.mockResolvedValue(new Map([['oreva', 4200]]));

    await expect(syncUserPlatforms('b1', 'brand')).resolves.toEqual({ checked: 1, updated: 1 });
    expect(updates()[0][0]).toContain('brand_profiles');
  });
});

describe('refreshStalePlatformStats', () => {
  it('batches each platform and keeps going when one platform fails', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [
        { role: 'brand', user_id: 'b1', platform: 'x', handle: 'oreva' },
        { role: 'influencer', user_id: 'c1', platform: 'x', handle: 'asha' },
        { role: 'influencer', user_id: 'c1', platform: 'youtube', handle: '@asha' },
        { role: 'influencer', user_id: 'c2', platform: 'youtube', handle: '@ravi' },
      ] })
      .mockResolvedValue({ rowCount: 1 });
    FETCHERS.x.fetch.mockResolvedValue(new Map([['oreva', 100], ['asha', 200]]));
    FETCHERS.youtube.fetch
      .mockRejectedValueOnce(new Error('actor timed out'))
      .mockResolvedValueOnce(new Map([['@ravi', 300]]));

    await expect(refreshStalePlatformStats()).resolves.toEqual({ checked: 4, updated: 3 });
    expect(FETCHERS.x.fetch).toHaveBeenCalledTimes(1); // one batch for both X accounts
    expect(FETCHERS.x.fetch).toHaveBeenCalledWith(['oreva', 'asha']);
    expect(FETCHERS.youtube.fetch).toHaveBeenCalledTimes(2); // one channel per run
  });

  it('skips a write when the user changed handles mid-run', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ role: 'brand', user_id: 'b1', platform: 'x', handle: 'old' }] })
      .mockResolvedValue({ rowCount: 0 });
    FETCHERS.x.fetch.mockResolvedValue(new Map([['old', 5]]));

    await expect(refreshStalePlatformStats()).resolves.toEqual({ checked: 1, updated: 0 });
    expect(invalidateCache).not.toHaveBeenCalled();
  });
});
