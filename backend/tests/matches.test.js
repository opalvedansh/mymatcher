const request = require('supertest');

// Global mock of the database module
jest.mock('../src/config/db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn() },
}));

// Mock authentication
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

// Mock Socket.io
jest.mock('../src/socket', () => ({
  initSocket: jest.fn(),
  getIO: jest.fn(() => ({ to: jest.fn().mockReturnThis(), emit: jest.fn() })),
}));

// Mock Sentry
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

describe('Match Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/matches', () => {
    it('should return a paginated list of active matches', async () => {
      const mockMatches = [
        { match_id: 'm1', status: 'active', matched_at: new Date('2024-01-02T10:00:00Z') },
        { match_id: 'm2', status: 'active', matched_at: new Date('2024-01-01T10:00:00Z') },
      ];
      
      db.query.mockResolvedValueOnce({ rows: mockMatches });

      const res = await request(server).get('/api/matches?limit=2');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data[0].match_id).toBe('m1');
      expect(res.body.next_cursor).toBe(mockMatches[1].matched_at.toISOString());
    });

    it('should reject malformed cursor', async () => {
      const res = await request(server).get('/api/matches?cursor=invalid_date');
      expect(res.status).toBe(422);
    });
  });

  describe('GET /api/matches/:matchId', () => {
    it('should return 422 for a non-UUID matchId', async () => {
      const res = await request(server).get('/api/matches/123-invalid');
      expect(res.status).toBe(422);
    });

    it('should return the match if found', async () => {
      const mockMatch = { match_id: '123e4567-e89b-12d3-a456-426614174000', status: 'active' };
      db.query.mockResolvedValueOnce({ rows: [mockMatch] });

      const res = await request(server).get('/api/matches/123e4567-e89b-12d3-a456-426614174000');
      
      expect(res.status).toBe(200);
      expect(res.body.match_id).toBe(mockMatch.match_id);
    });
  });
});
