const request = require('supertest');

jest.mock('../src/config/db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'test-user-id-123', email: 'test@example.com', role: 'influencer', banned: false };
    next();
  },
  authenticateTokenOnly: (req, res, next) => {
    req.user = { id: 'test-user-id-123', email: 'test@example.com' };
    next();
  },
  requireRole: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
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

afterAll(async () => {
  if (server && server.close) {
    await new Promise(resolve => server.close(resolve));
  }
});

const VALID_ID = '2b1f0c2e-4a57-4b8e-9a64-0c1f0d0b7a11';

describe('Notification Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/notifications', () => {
    it('lists my notifications, hiding blocked users and anonymising likes', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: VALID_ID, type: 'new_like', title: 'Someone likes you', actor_id: null, actor_name: null }],
      });

      const res = await request(server).get('/api/notifications?limit=10');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.next_before).toBeNull();

      const [sql, params] = db.query.mock.calls[0];
      expect(params).toEqual(['test-user-id-123', 10]);
      expect(sql).toMatch(/user_blocks/);
      expect(sql).toMatch(/WHEN n\.type = 'new_like' THEN NULL ELSE COALESCE\(ip\.name, bp\.name\)/);
    });

    it('pages with a before cursor', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(server).get('/api/notifications?before=2026-09-01T10:00:00.000Z');

      expect(res.status).toBe(200);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/n\.created_at < \$3/);
      expect(params[2]).toBe('2026-09-01T10:00:00.000Z');
    });

    it('rejects an out-of-range limit', async () => {
      const res = await request(server).get('/api/notifications?limit=500');
      expect(res.status).toBe(422);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/notifications/unread-count', () => {
    it('returns the unread count', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ count: 4 }] });

      const res = await request(server).get('/api/notifications/unread-count');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(4);
      expect(db.query.mock.calls[0][0]).toMatch(/read_at IS NULL/);
    });
  });

  describe('POST /api/notifications/read', () => {
    it('marks everything read when no ids are given', async () => {
      db.query.mockResolvedValueOnce({ rowCount: 3 });

      const res = await request(server).post('/api/notifications/read').send({});

      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(3);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).not.toMatch(/ANY/);
      expect(params).toEqual(['test-user-id-123']);
    });

    it('marks only the given ids read', async () => {
      db.query.mockResolvedValueOnce({ rowCount: 1 });

      const res = await request(server).post('/api/notifications/read').send({ ids: [VALID_ID] });

      expect(res.status).toBe(200);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/id = ANY\(\$2::uuid\[\]\)/);
      expect(params).toEqual(['test-user-id-123', [VALID_ID]]);
    });

    it('rejects ids that are not UUIDs', async () => {
      const res = await request(server).post('/api/notifications/read').send({ ids: ['nope'] });
      expect(res.status).toBe(422);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/auth/push-token', () => {
    it('saves a token and removes it from other accounts', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const res = await request(server)
        .put('/api/auth/push-token')
        .send({ token: 'ExponentPushToken[abc123]' });

      expect(res.status).toBe(200);
      expect(db.query.mock.calls[0][0]).toMatch(/expo_push_token = NULL/);
      expect(db.query.mock.calls[0][1]).toEqual(['ExponentPushToken[abc123]', 'test-user-id-123']);
      expect(db.query.mock.calls[1][1]).toEqual(['ExponentPushToken[abc123]', 'test-user-id-123']);
    });

    it('clears the token on sign-out', async () => {
      db.query.mockResolvedValue({ rows: [] });

      const res = await request(server).put('/api/auth/push-token').send({ token: null });

      expect(res.status).toBe(200);
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(db.query.mock.calls[0][1]).toEqual([null, 'test-user-id-123']);
    });

    it('rejects a token that is not an Expo push token', async () => {
      const res = await request(server).put('/api/auth/push-token').send({ token: 'not-a-token' });
      expect(res.status).toBe(422);
    });
  });
});
