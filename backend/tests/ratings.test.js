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

jest.mock('../src/utils/blocks', () => ({
  isBlockedBetween: jest.fn().mockResolvedValue(false),
  blockedBetween: jest.fn().mockResolvedValue([]),
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

describe('Brand ratings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isBlockedBetween.mockResolvedValue(false);
  });

  describe('GET /api/ratings/:brandId', () => {
    it('returns the average, my score and whether I may rate', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ count: 4, average: '4.3', recommend_count: 3 }] })
        .mockResolvedValueOnce({ rows: [{ score: 5, updated_at: '2026-09-01T00:00:00Z' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'match-1' }] });

      const res = await request(server).get('/api/ratings/brand-1');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ count: 4, average: 4.3, my_score: 5, can_rate: true });
    });

    it('says a creator with no match may not rate', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ count: 0, average: null, recommend_count: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(server).get('/api/ratings/brand-1');

      expect(res.body).toMatchObject({ count: 0, average: null, my_score: null, can_rate: false });
    });

    it('hides a brand that blocked the viewer', async () => {
      isBlockedBetween.mockResolvedValue(true);

      const res = await request(server).get('/api/ratings/brand-1');

      expect(res.status).toBe(404);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/ratings/:brandId', () => {
    it('records a score from a matched creator', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 'match-1' }] })  // match lookup
        .mockResolvedValueOnce({ rowCount: 1 })                 // upsert
        .mockResolvedValueOnce({ rows: [{ count: 5, average: '4.4' }] });

      const res = await request(server).put('/api/ratings/brand-1').send({ score: 4 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ count: 5, average: 4.4, my_score: 4 });
      expect(db.query.mock.calls[1][0]).toContain('ON CONFLICT (brand_id, influencer_id)');
    });

    it('refuses a creator who never matched with the brand', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(server).put('/api/ratings/brand-1').send({ score: 5 });

      expect(res.status).toBe(403);
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('refuses a brand trying to rate', async () => {
      const res = await request(server)
        .put('/api/ratings/brand-1')
        .set('x-test-role', 'brand')
        .send({ score: 5 });

      expect(res.status).toBe(403);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects a score outside 1 to 5 with 422', async () => {
      const res = await request(server).put('/api/ratings/brand-1').send({ score: 9 });

      expect(res.status).toBe(422);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('rejects a missing score with 422', async () => {
      const res = await request(server).put('/api/ratings/brand-1').send({});

      expect(res.status).toBe(422);
    });
  });

  describe('DELETE /api/ratings/:brandId', () => {
    it('removes my own rating', async () => {
      db.query.mockResolvedValueOnce({ rowCount: 1 });

      const res = await request(server).delete('/api/ratings/brand-1');

      expect(res.status).toBe(200);
      expect(res.body.removed).toBe(1);
      expect(db.query.mock.calls[0][1]).toEqual(['brand-1', 'creator-1']);
    });
  });
});
