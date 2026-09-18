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
const server = require('../src/app');

afterAll(async () => {
  if (server && server.close) {
    await new Promise(resolve => server.close(resolve));
  }
});

describe('Profile Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/profiles/me', () => {
    it('should return the current user profile', async () => {
      const mockProfile = {
        user_id: 'test-user-id-123',
        name: 'Test Brand',
        bio: 'A test brand',
        categories: ['tech'],
        budget_min: 1000,
        budget_max: 5000,
      };
      db.query.mockResolvedValueOnce({ rows: [mockProfile] });

      const res = await request(server).get('/api/profiles/me');

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Test Brand');
    });

    it('should return 404 if profile does not exist', async () => {
      // First query returns empty (no profile), second is the INSERT, third is the re-fetch
      db.query.mockResolvedValueOnce({ rows: [] });
      db.query.mockResolvedValueOnce({ rowCount: 1 });
      db.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(server).get('/api/profiles/me');

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/profiles/me', () => {
    it('should update profile with valid data', async () => {
      db.query.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE
      db.query.mockResolvedValueOnce({ rows: [{ user_id: 'test-user-id-123', name: 'Updated Brand' }] }); // re-fetch

      const res = await request(server)
        .put('/api/profiles/me')
        .send({ name: 'Updated Brand', budget_min: 2000 });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Brand');
    });

    it('should reject non-numeric budget_min with 422', async () => {
      const res = await request(server)
        .put('/api/profiles/me')
        .send({ budget_min: 'not-a-number' });

      expect(res.status).toBe(422);
    });

    it('should reject non-numeric lat/lng with 422', async () => {
      const res = await request(server)
        .put('/api/profiles/me')
        .send({ lat: 'abc', lng: 'xyz' });

      expect(res.status).toBe(422);
    });

    it('should reject a negative budget with 422', async () => {
      const res = await request(server)
        .put('/api/profiles/me')
        .send({ budget_min: -500 });

      expect(res.status).toBe(422);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('should reject a campaign longer than a year with 422', async () => {
      const res = await request(server)
        .put('/api/profiles/me')
        .send({ campaign_days: 400 });

      expect(res.status).toBe(422);
    });

    it('should reject more than 99 of a deliverable with 422', async () => {
      const res = await request(server)
        .put('/api/profiles/me')
        .send({ deliverable_reels: 120 });

      expect(res.status).toBe(422);
    });

    it('should save the campaign types and vibes a brand picks', async () => {
      db.query.mockResolvedValueOnce({ rowCount: 1 });
      db.query.mockResolvedValueOnce({ rows: [{ user_id: 'test-user-id-123', vibes: ['Bold'] }] });

      const res = await request(server)
        .put('/api/profiles/me')
        .send({ campaign_types: ['UGC Campaign'], vibes: ['Bold'] });

      expect(res.status).toBe(200);
      const params = db.query.mock.calls[0][1];
      expect(params).toEqual(expect.arrayContaining([['UGC Campaign'], ['Bold']]));
    });

    it('should reject an oversized list of vibes with 422', async () => {
      const res = await request(server)
        .put('/api/profiles/me')
        .send({ vibes: Array.from({ length: 25 }, (_, i) => `v${i}`) });

      expect(res.status).toBe(422);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('should reject a campaign type that is not a short string with 422', async () => {
      const res = await request(server)
        .put('/api/profiles/me')
        .send({ campaign_types: ['x'.repeat(60)] });

      expect(res.status).toBe(422);
    });

    it('should save deliverables a brand asks for', async () => {
      db.query.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE
      db.query.mockResolvedValueOnce({ rows: [{ user_id: 'test-user-id-123', deliverable_reels: 2 }] }); // re-fetch

      const res = await request(server)
        .put('/api/profiles/me')
        .send({ deliverable_reels: 2, deliverable_stories: 3, deliverable_posts: 0 });

      expect(res.status).toBe(200);
      const params = db.query.mock.calls[0][1];
      expect(params).toEqual(expect.arrayContaining([2, 3, 0]));
    });
  });

  describe('POST /api/profiles/me/verification', () => {
    it('puts a brand in the review queue without verifying it', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ verification_status: 'none' }] })
        .mockResolvedValueOnce({ rows: [{ verification_status: 'pending', verification_business_name: 'Acme Retail' }] });

      const res = await request(server)
        .post('/api/profiles/me/verification')
        .send({ business_name: 'Acme Retail', reg_number: '29ABCDE1234F1Z5' });

      expect(res.status).toBe(200);
      expect(res.body.verification_status).toBe('pending');
      // The badge itself is never set here.
      expect(db.query.mock.calls[1][0]).not.toContain('verified');
    });

    it('refuses a second request while one is under review', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ verification_status: 'pending' }] });

      const res = await request(server)
        .post('/api/profiles/me/verification')
        .send({ business_name: 'Acme Retail', reg_number: '29ABCDE1234F1Z5' });

      expect(res.status).toBe(409);
    });

    it('refuses a creator', async () => {
      const res = await request(server)
        .post('/api/profiles/me/verification')
        .set('x-test-role', 'influencer')
        .send({ business_name: 'Acme Retail', reg_number: '29ABCDE1234F1Z5' });

      expect(res.status).toBe(403);
    });

    it('requires a business name and registration number', async () => {
      const res = await request(server)
        .post('/api/profiles/me/verification')
        .send({ business_name: 'A' });

      expect(res.status).toBe(422);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/profiles/me/responsiveness', () => {
    it('withholds the figures until there are enough conversations', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ conversations: '2', replied: '2', median_reply_seconds: '600' }],
      });

      const res = await request(server).get('/api/profiles/me/responsiveness');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        conversations: 2,
        replied: 2,
        min_sample: 3,
        response_rate: null,
        median_reply_seconds: null,
      });
    });

    it('reports the rate and median once there are enough', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ conversations: '8', replied: '6', median_reply_seconds: '5400.4' }],
      });

      const res = await request(server).get('/api/profiles/me/responsiveness');

      expect(res.status).toBe(200);
      expect(res.body.response_rate).toBe(75);
      expect(res.body.median_reply_seconds).toBe(5400);
    });

    it('handles a user nobody has messaged', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ conversations: '0', replied: '0', median_reply_seconds: null }],
      });

      const res = await request(server).get('/api/profiles/me/responsiveness');

      expect(res.status).toBe(200);
      expect(res.body.conversations).toBe(0);
      expect(res.body.response_rate).toBeNull();
    });

    it('counts against the brand side of the match for a brand', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ conversations: '3', replied: '3', median_reply_seconds: '60' }],
      });

      await request(server).get('/api/profiles/me/responsiveness');

      expect(db.query.mock.calls[0][0]).toContain('m.brand_id');
      expect(db.query.mock.calls[0][1]).toEqual(['test-user-id-123']);
    });

    it('counts against the influencer side for a creator', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ conversations: '3', replied: '1', median_reply_seconds: '60' }],
      });

      await request(server)
        .get('/api/profiles/me/responsiveness')
        .set('x-test-role', 'influencer');

      expect(db.query.mock.calls[0][0]).toContain('m.influencer_id');
    });
  });
});
