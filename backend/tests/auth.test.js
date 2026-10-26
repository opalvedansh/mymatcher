const request = require('supertest');

// Mock db BEFORE requiring app
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

// Set test port to avoid collision
process.env.PORT = '0'; // Random available port
process.env.NODE_ENV = 'test';

const db = require('../src/config/db');
const server = require('../src/app');

afterAll(async () => {
  if (server && server.close) {
    await new Promise(resolve => server.close(resolve));
  }
});

describe('Auth Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/sync', () => {
    it('should create a new user on first sync', async () => {
      const mockUser = { id: 'test-user-id-123', email: 'test@example.com', role: 'brand', created_at: new Date() };
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [mockUser] }) // UPSERT user
          .mockResolvedValueOnce({}) // INSERT profile
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      db.getClient.mockResolvedValue(mockClient);

      const res = await request(server)
        .post('/api/auth/sync')
        .send({ role: 'brand' });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.role).toBe('brand');
    });

    it('should reject invalid role with 422', async () => {
      const res = await request(server)
        .post('/api/auth/sync')
        .send({ role: 'invalid_role' });

      expect(res.status).toBe(422);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return the current user', async () => {
      const mockUser = { id: 'test-user-id-123', email: 'test@example.com', role: 'brand', created_at: new Date() };
      db.query.mockResolvedValueOnce({ rows: [mockUser] });

      const res = await request(server).get('/api/auth/me');

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('test@example.com');
    });
  });

  describe('PUT /api/auth/push-token', () => {
    it('should save a valid push token', async () => {
      db.query.mockResolvedValueOnce({ rowCount: 1 });

      const res = await request(server)
        .put('/api/auth/push-token')
        .send({ token: 'ExponentPushToken[xxxx]' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject missing token with 422', async () => {
      const res = await request(server)
        .put('/api/auth/push-token')
        .send({});

      expect(res.status).toBe(422);
    });
  });

  describe('/api/auth/web-push', () => {
    const sub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: { p256dh: 'BPkey', auth: 'authkey' },
    };

    it('saves a browser subscription for the current user', async () => {
      db.query.mockResolvedValueOnce({ rowCount: 1 });

      const res = await request(server).put('/api/auth/web-push').send(sub);

      expect(res.status).toBe(200);
      expect(db.query.mock.calls.at(-1)[1]).toEqual(['test-user-id-123', sub.endpoint, 'BPkey', 'authkey']);
    });

    it('rejects endpoints that are not a browser push service', async () => {
      for (const endpoint of ['http://169.254.169.254/latest', 'https://evil.example.com/push', 'not a url']) {
        const res = await request(server).put('/api/auth/web-push').send({ ...sub, endpoint });
        expect(res.status).toBe(422);
      }
      expect(db.query).not.toHaveBeenCalled();
    });

    it('deletes only the current user\'s subscription', async () => {
      db.query.mockResolvedValueOnce({ rowCount: 1 });

      const res = await request(server).delete('/api/auth/web-push').query({ endpoint: sub.endpoint });

      expect(res.status).toBe(200);
      expect(db.query.mock.calls.at(-1)[1]).toEqual([sub.endpoint, 'test-user-id-123']);
    });
  });
});
