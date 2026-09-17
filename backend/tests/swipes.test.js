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
const notificationService = require('../src/services/notificationService');
const server = require('../src/app');

afterAll(async () => {
  if (server && server.close) {
    await new Promise(resolve => server.close(resolve));
  }
});

describe('Swipe Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/swipes', () => {
    it('should record a like swipe', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'target-user', role: 'influencer' }] }) // Verify target
          .mockResolvedValueOnce({}) // pair advisory lock
          .mockResolvedValueOnce({ rows: [{ id: 'swipe-1', direction: 'like' }] }) // INSERT swipe
          .mockResolvedValueOnce({ rows: [] }) // No reciprocal swipe
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      db.getClient.mockResolvedValue(mockClient);

      const res = await request(server)
        .post('/api/swipes')
        .send({ swiped_id: 'target-user', direction: 'like' });

      expect(res.status).toBe(201);
      expect(res.body.matched).toBe(false);
      // An unmatched like tells the other person, anonymously.
      expect(notificationService.sendLikeNotification).toHaveBeenCalledWith('target-user', 'test-user-id-123');
      expect(notificationService.sendMatchNotifications).not.toHaveBeenCalled();
    });

    it('should not send a like notification for a reject', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'target-user', role: 'influencer' }] }) // Verify target
          .mockResolvedValueOnce({}) // pair advisory lock
          .mockResolvedValueOnce({ rows: [{ id: 'swipe-2', direction: 'reject' }] }) // INSERT swipe
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      db.getClient.mockResolvedValue(mockClient);

      const res = await request(server)
        .post('/api/swipes')
        .send({ swiped_id: 'target-user', direction: 'reject' });

      expect(res.status).toBe(201);
      expect(notificationService.sendLikeNotification).not.toHaveBeenCalled();
    });

    it('should create a match on reciprocal like', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'target-user', role: 'influencer' }] }) // Verify target
          .mockResolvedValueOnce({}) // pair advisory lock
          .mockResolvedValueOnce({ rows: [{ id: 'swipe-1', direction: 'like' }] }) // INSERT swipe
          .mockResolvedValueOnce({ rows: [{ id: 'reciprocal-swipe' }] }) // RECIPROCAL exists!
          .mockResolvedValueOnce({ rows: [{ id: 'match-1', brand_id: 'test-user-id-123', influencer_id: 'target-user' }] }) // INSERT match
          .mockResolvedValueOnce({ rows: [{ user_id: 'test-user-id-123', name: 'Test Brand' }, { user_id: 'target-user', name: 'Test Influencer' }] }) // Names for notification
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      db.getClient.mockResolvedValue(mockClient);

      const res = await request(server)
        .post('/api/swipes')
        .send({ swiped_id: 'target-user', direction: 'like' });

      expect(res.status).toBe(201);
      expect(res.body.matched).toBe(true);
      expect(res.body.match).toBeDefined();
      expect(notificationService.sendMatchNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ swiperId: 'test-user-id-123', swipedId: 'target-user', matchId: 'match-1' })
      );
      expect(notificationService.sendLikeNotification).not.toHaveBeenCalled();
    });

    it('takes the pair lock before writing, keyed the same for both users', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'target-user', role: 'influencer' }] })
          .mockResolvedValueOnce({}) // lock
          .mockResolvedValueOnce({ rows: [{ id: 'swipe-1', direction: 'like' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      db.getClient.mockResolvedValue(mockClient);

      await request(server)
        .post('/api/swipes')
        .send({ swiped_id: 'target-user', direction: 'like' });

      const [lockSql, lockParams] = mockClient.query.mock.calls[2];
      expect(lockSql).toMatch(/pg_advisory_xact_lock/);
      // Sorted, so A→B and B→A contend for the same lock.
      expect(lockParams).toEqual(['target-user:test-user-id-123']);
      const insertIndex = mockClient.query.mock.calls.findIndex(([sql]) => /INSERT INTO swipes/.test(sql));
      expect(insertIndex).toBeGreaterThan(2);
    });

    it('rejects swiping on a user who has not picked a role', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'target-user', role: null }] })
          .mockResolvedValueOnce({}), // ROLLBACK
        release: jest.fn(),
      };
      db.getClient.mockResolvedValue(mockClient);

      const res = await request(server)
        .post('/api/swipes')
        .send({ swiped_id: 'target-user', direction: 'like' });

      expect(res.status).toBe(400);
    });

    it('should reject swiping on a user with the same role', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'target-user', role: 'brand' }] }), // Same role!
        release: jest.fn(),
      };
      db.getClient.mockResolvedValue(mockClient);

      const res = await request(server)
        .post('/api/swipes')
        .send({ swiped_id: 'target-user', direction: 'like' });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/swipes/last', () => {
    it('should undo the last swipe within the undo window', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'swipe-1', direction: 'reject', swiped_id: 'other-user', updated_at: new Date() }] }) // Find last swipe
          .mockResolvedValueOnce({}) // DELETE swipe
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      db.getClient.mockResolvedValue(mockClient);

      const res = await request(server).delete('/api/swipes/last');

      expect(res.status).toBe(200);
      expect(res.body.undone).toBe(true);
    });

    it('should return 400 if nothing to undo', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [] }), // No recent swipe
        release: jest.fn(),
      };
      db.getClient.mockResolvedValue(mockClient);

      const res = await request(server).delete('/api/swipes/last');

      expect(res.status).toBe(400);
    });
  });
});
