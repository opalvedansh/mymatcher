const { cleanPlatformFollowers, withSyncedInstagram } = require('../src/utils/platformFollowers');

describe('cleanPlatformFollowers', () => {
  it('stores typed counts as self-reported', () => {
    const map = cleanPlatformFollowers({ YouTube: 12000, x: 0 });
    expect(map.youtube).toMatchObject({ count: 12000, source: 'self' });
    expect(map.x).toMatchObject({ count: 0, source: 'self' });
    expect(Date.parse(map.youtube.updated_at)).not.toBeNaN();
  });

  it('replaces typed counts but never a synced one', () => {
    const stored = {
      youtube: { count: 50000, source: 'synced', updated_at: '2026-10-01T00:00:00.000Z' },
      x: { count: 900, source: 'self', updated_at: '2026-10-01T00:00:00.000Z' },
    };
    const map = cleanPlatformFollowers({ youtube: 99999999, tiktok: 300 }, stored);
    expect(map.youtube).toEqual(stored.youtube);
    expect(map.tiktok).toMatchObject({ count: 300, source: 'self' });
    expect(map.x).toBeUndefined(); // left out of the replacement list
  });

  it('keeps the date of a count that did not change', () => {
    const stored = { x: { count: 900, source: 'self', updated_at: '2026-10-01T00:00:00.000Z' } };
    expect(cleanPlatformFollowers({ x: 900 }, stored).x.updated_at).toBe('2026-10-01T00:00:00.000Z');
    expect(cleanPlatformFollowers({ x: 901 }, stored).x.updated_at).not.toBe('2026-10-01T00:00:00.000Z');
  });

  it('drops platforms whose count lives elsewhere', () => {
    expect(cleanPlatformFollowers({ instagram: 5, x: 1 }, {}, ['instagram'])).not.toHaveProperty('instagram');
  });

  it.each([
    ['a list', [1, 2]],
    ['a negative count', { x: -1 }],
    ['a fractional count', { x: 1.5 }],
    ['a count sent as text', { x: '1000' }],
    ['an absurd count', { x: 3e9 }],
    ['a bad platform id', { 'you tube!': 10 }],
    ['too many platforms', Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`p${i}`, 1]))],
  ])('rejects %s with a 400 error', (_label, input) => {
    expect(() => cleanPlatformFollowers(input)).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('withSyncedInstagram', () => {
  it('shows a synced Instagram count as the Instagram entry', () => {
    const map = withSyncedInstagram({ instagram: { count: 1, source: 'self' } }, 4200, '2026-10-20T00:00:00Z');
    expect(map.instagram).toEqual({ count: 4200, source: 'synced', updated_at: '2026-10-20T00:00:00.000Z' });
  });

  it('leaves a typed Instagram count when nothing has synced', () => {
    const typed = { instagram: { count: 800, source: 'self' } };
    expect(withSyncedInstagram(typed, 0, null)).toEqual(typed);
    expect(withSyncedInstagram(null, 0, null)).toEqual({});
  });
});
