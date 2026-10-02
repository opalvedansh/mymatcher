const request = require('supertest');

jest.mock('../src/config/db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      id: req.headers['x-test-user'] || 'creator-1',
      email: 'test@example.com',
      role: req.headers['x-test-role'] || 'influencer',
      banned: false,
    };
    next();
  },
  authenticateTokenOnly: (req, res, next) => {
    req.user = { id: 'creator-1', email: 'test@example.com' };
    next();
  },
  requireRole: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

// The real blockedBetween: it only builds SQL, which the tests inspect.
jest.mock('../src/utils/blocks', () => ({
  ...jest.requireActual('../src/utils/blocks'),
  isBlockedBetween: jest.fn().mockResolvedValue(false),
}));

jest.mock('../src/middleware/cacheMiddleware', () => ({
  cache: () => (req, res, next) => next(),
  invalidateCache: jest.fn().mockResolvedValue(),
}));

jest.mock('../src/socket', () => ({
  initSocket: jest.fn(),
  getIO: jest.fn(() => ({ to: jest.fn().mockReturnThis(), emit: jest.fn() })),
}));

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  setupExpressErrorHandler: jest.fn(() => (err, req, res, next) => next(err)),
}));


process.env.PORT = '0';
process.env.NODE_ENV = 'test';

const db = require('../src/config/db');
const { isBlockedBetween } = require('../src/utils/blocks');
const server = require('../src/app');

afterAll(async () => {
  if (server && server.close) await new Promise((resolve) => server.close(resolve));
});

const REVIEW = {
  id: 'rev-1', brand_id: 'brand-1', quote: 'Delivered early and the reel did great.',
  reviewer_name: 'Riya Menon', reviewer_title: 'Brand Manager at Nike',
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  brand_name: 'Nike', brand_logo_url: null, brand_verified: true,
};

// Answers each query by what it asks for, so the tests don't depend on the
// order loadReviews happens to issue them in.
function mockDb({ reviews = [REVIEW], summary = { count: 1 }, mine = null, match = null } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (sql.includes('FROM matches')) return { rows: match ? [match] : [] };
    if (sql.includes('COUNT(*)')) return { rows: [summary] };
    if (sql.includes('SELECT quote, reviewer_name')) return { rows: mine ? [mine] : [] };
    if (sql.includes('INSERT INTO creator_reviews') || sql.includes('DELETE FROM creator_reviews')) {
      return { rowCount: 1 };
    }
    return { rows: reviews };
  });
}

const asBrand = (req) => req.set('x-test-user', 'brand-1').set('x-test-role', 'brand');
const sqlCalls = () => db.query.mock.calls.map(([sql]) => sql);

describe('Creator reviews', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockReset();
    isBlockedBetween.mockResolvedValue(false);
  });

  describe('GET /api/reviews/:creatorId', () => {
    it('lists the reviews with the brand that wrote each', async () => {
      mockDb();

      const res = await request(server).get('/api/reviews/creator-2');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ count: 1, my_review: null, can_review: false });
      expect(res.body.reviews[0]).toMatchObject({ brand_name: 'Nike', reviewer_name: 'Riya Menon' });
    });

    it('leaves out reviews by brands either side has blocked', async () => {
      mockDb();

      await request(server).get('/api/reviews/creator-2');

      const listSql = sqlCalls().find((sql) => sql.includes('ORDER BY r.updated_at'));
      expect(listSql).toContain('user_blocks');
      expect(listSql).toContain('u.banned = false');
    });

    it('never lets the creator review themselves', async () => {
      mockDb({ match: { id: 'match-1' } });

      const res = await request(server).get('/api/reviews/creator-1');

      expect(res.body.can_review).toBe(false);
      expect(sqlCalls().some((sql) => sql.includes('FROM matches'))).toBe(false);
    });

    it('lets a matched brand review and returns what it wrote', async () => {
      mockDb({ match: { id: 'match-1' }, mine: { quote: 'Great to work with.', reviewer_name: 'Riya Menon' } });

      const res = await asBrand(request(server).get('/api/reviews/creator-2'));

      expect(res.body).toMatchObject({ can_review: true, my_review: { reviewer_name: 'Riya Menon' } });
    });

    it('does not let a brand that never matched review', async () => {
      mockDb();

      const res = await asBrand(request(server).get('/api/reviews/creator-2'));

      expect(res.body.can_review).toBe(false);
    });

    it('hides a creator who blocked the viewer', async () => {
      isBlockedBetween.mockResolvedValue(true);

      const res = await request(server).get('/api/reviews/creator-2');

      expect(res.status).toBe(404);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/reviews/:creatorId', () => {
    const review = {
      quote: '  Delivered early and the reel did great.  ',
      reviewer_name: 'Riya Menon',
      reviewer_title: 'Brand Manager at Nike',
    };

    it('saves a review from a matched brand, editing any earlier one', async () => {
      mockDb({ match: { id: 'match-1' } });

      const res = await asBrand(request(server).put('/api/reviews/creator-2').send(review));

      expect(res.status).toBe(200);
      const upsert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO creator_reviews'));
      expect(upsert[0]).toContain('ON CONFLICT (influencer_id, brand_id)');
      expect(upsert[1]).toEqual([
        'creator-2', 'brand-1', 'match-1',
        'Delivered early and the reel did great.', 'Riya Menon', 'Brand Manager at Nike',
      ]);
      // Reviews carry no LinkedIn link any more (migration 033).
      expect(upsert[0]).not.toContain('linkedin_url');
    });

    it('accepts a review without a role and company', async () => {
      mockDb({ match: { id: 'match-1' } });

      const res = await asBrand(request(server).put('/api/reviews/creator-2').send({ ...review, reviewer_title: '' }));

      expect(res.status).toBe(200);
      const upsert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO creator_reviews'));
      expect(upsert[1][5]).toBeNull();
    });

    it('refuses a brand that never matched with the creator', async () => {
      mockDb();

      const res = await asBrand(request(server).put('/api/reviews/creator-2').send(review));

      expect(res.status).toBe(403);
      expect(sqlCalls().some((sql) => sql.includes('INSERT'))).toBe(false);
    });

    it('refuses a creator, including on their own profile', async () => {
      const res = await request(server).put('/api/reviews/creator-1').send(review);

      expect(res.status).toBe(403);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('refuses a blocked pair', async () => {
      isBlockedBetween.mockResolvedValue(true);

      const res = await asBrand(request(server).put('/api/reviews/creator-2').send(review));

      expect(res.status).toBe(404);
      expect(db.query).not.toHaveBeenCalled();
    });

    it.each([
      ['a review that is too short', { quote: 'ok' }],
      ['a review over 600 characters', { quote: 'x'.repeat(601) }],
      ['a missing reviewer name', { reviewer_name: '  ' }],
      ['a missing review', { quote: undefined }],
    ])('rejects %s with 422', async (_label, change) => {
      const res = await asBrand(request(server).put('/api/reviews/creator-2').send({ ...review, ...change }));

      expect(res.status).toBe(422);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/reviews/:creatorId', () => {
    it('removes only my own review', async () => {
      mockDb();

      const res = await asBrand(request(server).delete('/api/reviews/creator-2'));

      expect(res.status).toBe(200);
      const del = db.query.mock.calls.find(([sql]) => sql.includes('DELETE FROM creator_reviews'));
      expect(del[1]).toEqual(['creator-2', 'brand-1']);
    });
  });
});
