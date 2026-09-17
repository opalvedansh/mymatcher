const request = require('supertest');

jest.mock('../src/config/db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      id: 'test-user-id-123',
      email: 'test@example.com',
      role: req.headers['x-test-role'] || 'brand',
      banned: false,
    };
    next();
  },
  authenticateTokenOnly: (req, res, next) => {
    // Mirrors the real middleware: identity from token claims only, no role.
    req.user = { id: 'test-user-id-123', email: 'test@example.com' };
    next();
  },
  requireRole: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  },
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
const server = require('../src/app');
const redis = require('../src/config/redis');
const sharedCache = require('../src/utils/sharedCache');

// The feed builds a deck (ranked ids) and then hydrates the page with a second
// ranking query restricted to those ids; both return the same rows here.
function mockFeedQueries(weightsRows, viewerRows, feedRows) {
  db.query.mockResolvedValueOnce({ rows: weightsRows });
  db.query.mockResolvedValueOnce({ rows: viewerRows });
  db.query.mockResolvedValueOnce({ rows: feedRows });
  db.query.mockResolvedValueOnce({ rows: feedRows });
}

afterAll(async () => {
  if (server && server.close) {
    await new Promise(resolve => server.close(resolve));
  }
});

describe('Feed Routes', () => {
  beforeEach(async () => {
    jest.resetAllMocks();
    await redis.flushall();
    sharedCache._local.flush();
  });

  describe('GET /api/feed', () => {
    it('should return scored feed results for a brand', async () => {
      mockFeedQueries(
        [],
        [{ categories: ['tech'], budget_min: 1000, budget_max: 5000, location: 'Mumbai', lat: 19.07, lng: 72.87 }],
        [
          { id: 'inf-1', name: 'Influencer 1', relevance_score: 85, created_at: new Date() },
          { id: 'inf-2', name: 'Influencer 2', relevance_score: 72, created_at: new Date() },
        ],
      );

      const res = await request(server).get('/api/feed');

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.length).toBe(2);
      expect(res.body.data.map((r) => r.id)).toEqual(['inf-1', 'inf-2']);
      // Hydration asks only for the ids in the deck.
      expect(db.query.mock.calls[3][1][14]).toEqual(['inf-1', 'inf-2']);
    });

    it('should respect the limit param', async () => {
      mockFeedQueries(
        [],
        [{ categories: ['tech'], budget_min: 1000, budget_max: 5000, location: 'Mumbai', lat: null, lng: null }],
        [{ id: 'inf-1', name: 'Influencer 1', relevance_score: 85, created_at: new Date() }],
      );

      const res = await request(server).get('/api/feed?limit=1');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(1);
    });

    it('should work for an influencer user', async () => {
      mockFeedQueries(
        [],
        [{ categories: ['beauty'], price_min: 500, price_max: 2000, location: 'Delhi', lat: 28.61, lng: 77.20, platforms: ['instagram'] }],
        [{ id: 'brand-1', name: 'Brand 1', relevance_score: 90, created_at: new Date() }],
      );

      const res = await request(server)
        .get('/api/feed')
        .set('x-test-role', 'influencer');

      expect(res.status).toBe(200);
      expect(res.body.data.map((r) => r.id)).toEqual(['brand-1']);
    });
  });
});
