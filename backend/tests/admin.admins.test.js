const request = require('supertest');

jest.mock('../src/utils/sharedCache', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  redisReady: () => false,
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'admin-1', email: 'a@b.c' }; next(); },
  authenticateTokenOnly: (req, _res, next) => { req.user = { id: 'admin-1', email: 'a@b.c' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

process.env.PORT = '0';
process.env.NODE_ENV = 'test';

const db = require('../src/config/db');
const server = require('../src/app');

const admin = (role = 'superadmin') => ({ rows: [{ user_id: 'admin-1', email: 'a@b.c', role }] });

/** A getClient() whose queries are driven by a queue, like db.query's. */
function mockClient(results) {
  const queue = [...results];
  const client = {
    query: jest.fn(() => {
      const next = queue.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next ?? { rows: [] });
    }),
    release: jest.fn(),
  };
  db.getClient.mockResolvedValue(client);
  return client;
}

// clearAllMocks clears call history but NOT queued mockResolvedValueOnce
// values, so an unconsumed queue from one case would be read by the next.
beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.getClient.mockReset();
});
afterAll(async () => { if (server?.close) await new Promise((r) => server.close(r)); });

describe('GET /api/admin/me', () => {
  it('returns the permission list, not just the role', async () => {
    db.query.mockResolvedValueOnce(admin('moderator'));
    const res = await request(server).get('/api/admin/me');

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('moderator');
    // The panel renders its nav from this. Returning only the role would force
    // the frontend to hardcode the mapping and let the two drift.
    expect(res.body.permissions).toContain('reports:write');
    expect(res.body.permissions).not.toContain('messages:read');
    expect(Array.isArray(res.body.all_permissions)).toBe(true);
  });

  it('is open to every active admin, whatever their role', async () => {
    db.query.mockResolvedValueOnce(admin('analyst'));
    const res = await request(server).get('/api/admin/me');
    expect(res.status).toBe(200);
  });
});

describe('granting', () => {
  it('rejects an unknown role', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server).post('/api/admin/admins').send({ user_id: 'u-2', role: 'root' });
    expect(res.status).toBe(422);
  });

  it('is closed to a moderator', async () => {
    db.query.mockResolvedValueOnce(admin('moderator')).mockResolvedValue({ rows: [] });
    const res = await request(server).post('/api/admin/admins').send({ user_id: 'u-2', role: 'support' });
    expect(res.status).toBe(403);
  });

  it('clears the permission cache so the grant is not delayed by it', async () => {
    const sharedCache = require('../src/utils/sharedCache');
    db.query
      .mockResolvedValueOnce(admin())
      .mockResolvedValueOnce({ rows: [{ user_id: 'u-2', email: 'x@y.z', role: 'support' }] })
      .mockResolvedValue({ rows: [{ id: 1 }] });

    await request(server).post('/api/admin/admins').send({ user_id: 'u-2', role: 'support' });
    expect(sharedCache.del).toHaveBeenCalledWith('admin:perms:u-2');
  });

  it('un-revokes rather than failing when the person was an admin before', async () => {
    db.query
      .mockResolvedValueOnce(admin())
      .mockResolvedValueOnce({ rows: [{ user_id: 'u-2', role: 'support' }] })
      .mockResolvedValue({ rows: [{ id: 1 }] });

    await request(server).post('/api/admin/admins').send({ user_id: 'u-2', role: 'support' });

    const insert = db.query.mock.calls.find(([sql]) => /INSERT INTO admin_users/.test(sql));
    expect(insert[0]).toMatch(/ON CONFLICT \(user_id\) DO UPDATE/);
    expect(insert[0]).toMatch(/revoked_at = NULL/);
  });
});

describe('guard rails', () => {
  it('refuses self-revocation', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server).delete('/api/admin/admins/admin-1').send({ reason: 'leaving the company' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/cannot revoke your own access/);
  });

  it('refuses a self-demotion', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server).patch('/api/admin/admins/admin-1').send({ role: 'analyst' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/cannot change your own role/);
  });

  it('refuses to revoke the last superadmin', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [{ id: 1 }] });
    mockClient([
      undefined,                                                   // BEGIN
      { rows: [{ user_id: 'u-2', role: 'superadmin' }] },          // SELECT ... FOR UPDATE
      { rows: [{ remaining: 0 }] },                                // the count
    ]);

    const res = await request(server).delete('/api/admin/admins/u-2').send({ reason: 'no longer with us' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/last superadmin/);
  });

  it('checks that count inside the transaction, not before it', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [{ id: 1 }] });
    const client = mockClient([
      undefined,
      { rows: [{ user_id: 'u-2', role: 'superadmin' }] },
      { rows: [{ remaining: 1 }] },
      { rows: [{ user_id: 'u-2', revoked_at: new Date() }] },
    ]);

    await request(server).delete('/api/admin/admins/u-2').send({ reason: 'no longer with us' });

    const sqls = client.query.mock.calls.map(([sql]) => sql);
    // Two concurrent revocations that each read a count of 2 outside the
    // transaction would both succeed and lock everyone out.
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.findIndex((s) => /FOR UPDATE/.test(s))).toBeLessThan(
      sqls.findIndex((s) => /count\(\*\)/.test(s))
    );
    expect(sqls).toContain('COMMIT');
  });

  it('rolls back and releases the client when a query fails', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [{ id: 1 }] });
    const client = mockClient([undefined, new Error('deadlock detected')]);

    await request(server).delete('/api/admin/admins/u-2').send({ reason: 'no longer with us' });

    expect(client.query.mock.calls.map(([s]) => s)).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('audit log', () => {
  it('is append-only: the router registers no write route', () => {
    const router = require('../src/routes/admin/admins');
    const auditRoutes = router.stack
      .filter((layer) => layer.route?.path?.startsWith('/audit'))
      .flatMap((layer) => Object.keys(layer.route.methods));

    expect(auditRoutes.every((m) => m === 'get')).toBe(true);
  });

  it('keyset-pages on the serial id', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    await request(server).get('/api/admin/audit?cursor=500');

    const call = db.query.mock.calls.find(([sql]) => /FROM admin_audit_log/.test(sql));
    expect(call[0]).toMatch(/l\.id < \$/);
    expect(call[1]).toContain(500);
  });

  it('rejects a cursor that is not a number', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server).get('/api/admin/audit?cursor=abc');
    expect(res.status).toBe(422);
  });

  it('renders the ip as text rather than leaking a raw inet', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    await request(server).get('/api/admin/audit');

    const call = db.query.mock.calls.find(([sql]) => /FROM admin_audit_log/.test(sql));
    expect(call[0]).toMatch(/host\(l\.ip\) AS ip/);
  });
});
