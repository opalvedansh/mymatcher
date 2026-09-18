const request = require('supertest');

// A permanent cache miss: requireAdmin caches a permission lookup for 30s,
// which would otherwise let the identity set up by one case leak into the next.
jest.mock('../src/utils/sharedCache', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  redisReady: () => false,
}));

// Stands in for authenticateTokenOnly. Note there is no users-row lookup here,
// because the real middleware does not do one either — that is the point of
// the admin auth change.
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'admin-1', email: 'admin@matchr.in', role: 'brand', banned: false };
    next();
  },
  authenticateTokenOnly: (req, _res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'admin-1', email: 'admin@matchr.in' };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

process.env.PORT = '0';
process.env.NODE_ENV = 'test';

const db = require('../src/config/db');
const requireAdmin = require('../src/middleware/requireAdmin');
const server = require('../src/app');

const adminRow = (role) => ({ rows: [{ user_id: 'admin-1', email: 'admin@matchr.in', role }] });

// clearAllMocks clears call history but NOT queued mockResolvedValueOnce
// values, so an unconsumed queue from one case would be read by the next.
beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.getClient.mockReset();
});
afterAll(async () => { if (server?.close) await new Promise((r) => server.close(r)); });

describe('admin authorization', () => {
  it('rejects a caller with no admin_users row', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(server).get('/api/admin/stats');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required');
  });

  it('rejects a revoked admin', async () => {
    // loadAdmin's query carries `AND revoked_at IS NULL`, so a revoked admin
    // is simply not found.
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(server).get('/api/admin/stats');
    expect(res.status).toBe(403);
    expect(db.query.mock.calls[0][0]).toMatch(/revoked_at IS NULL/);
  });

  it('rejects a role that lacks the permission, and names it', async () => {
    db.query.mockResolvedValueOnce(adminRow('analyst'));
    const res = await request(server)
      .post('/api/admin/users/u-1/ban')
      .send({ reason: 'spamming every match' });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: 'Insufficient admin permission',
      required_permission: 'users:ban',
      your_role: 'analyst',
    });
  });

  it('lets a superadmin through any permission', async () => {
    db.query
      .mockResolvedValueOnce(adminRow('superadmin'))
      .mockResolvedValueOnce({ rows: [{ total_users: '3', total_brands: '1' }] });

    const res = await request(server).get('/api/admin/stats');
    expect(res.status).toBe(200);
  });

  it('marks every admin response no-store', async () => {
    db.query
      .mockResolvedValueOnce(adminRow('superadmin'))
      .mockResolvedValueOnce({ rows: [{ total_users: '0' }] });

    const res = await request(server).get('/api/admin/stats');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('never asks for a users row — an admin need not have onboarded', async () => {
    db.query
      .mockResolvedValueOnce(adminRow('superadmin'))
      .mockResolvedValueOnce({ rows: [{ total_users: '0' }] });

    await request(server).get('/api/admin/stats');
    const sql = db.query.mock.calls.map((c) => c[0]).join('\n');
    expect(sql).not.toMatch(/SELECT id, email, role, banned FROM users/);
  });
});

describe('requireAdmin dual signature', () => {
  const runMiddleware = (mw, req) => new Promise((resolve) => {
    const res = {
      statusCode: 200,
      set() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    mw(req, res, () => resolve({ status: 200, body: null, passed: true }));
  });

  const reqFor = (id) => ({
    user: { id, email: 'a@b.c' },
    originalUrl: '/api/admin/x',
    header: () => undefined,
  });

  it('still works when called directly as 3-arg middleware', async () => {
    db.query.mockResolvedValueOnce(adminRow('moderator'));
    // This is how routes/admin.js called it before the rewrite. Keeping it
    // working is what let the middleware land without touching any route.
    const out = await runMiddleware(requireAdmin, reqFor('admin-1'));
    expect(out.passed).toBe(true);
  });

  it('works as a factory with a required permission', async () => {
    db.query.mockResolvedValueOnce(adminRow('moderator'));
    const out = await runMiddleware(requireAdmin('reports:write'), reqFor('admin-1'));
    expect(out.passed).toBe(true);
  });

  it('401s an unauthenticated caller', async () => {
    const out = await runMiddleware(requireAdmin('users:read'), { originalUrl: '/x', header: () => undefined });
    expect(out.status).toBe(401);
  });
});

describe('role → permission map', () => {
  it('gives only superadmin the full decrypted thread', () => {
    expect(requireAdmin.expandPermissions('superadmin')).toContain('messages:read');
    for (const role of ['moderator', 'support', 'analyst']) {
      expect(requireAdmin.expandPermissions(role)).not.toContain('messages:read');
    }
  });

  it('gives only superadmin the power to hard-delete or manage admins', () => {
    for (const role of ['moderator', 'support', 'analyst']) {
      const perms = requireAdmin.expandPermissions(role);
      expect(perms).not.toContain('users:delete');
      expect(perms).not.toContain('admins:write');
    }
  });

  it('expands superadmin to the concrete list, never a bare star', () => {
    const perms = requireAdmin.expandPermissions('superadmin');
    expect(perms).not.toContain('*');
    expect(perms).toEqual(expect.arrayContaining(requireAdmin.PERMISSIONS));
  });

  it('gives an analyst no write permission at all', () => {
    const writes = requireAdmin.expandPermissions('analyst').filter((p) => !p.endsWith(':read'));
    expect(writes).toEqual([]);
  });
});
