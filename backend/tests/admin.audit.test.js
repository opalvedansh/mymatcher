const request = require('supertest');

jest.mock('../src/utils/sharedCache', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  redisReady: () => false,
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'admin-1', email: 'admin@matchr.in' }; next(); },
  authenticateTokenOnly: (req, _res, next) => { req.user = { id: 'admin-1', email: 'admin@matchr.in' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../src/utils/sessions', () => ({ endSessions: jest.fn().mockResolvedValue() }));

process.env.PORT = '0';
process.env.NODE_ENV = 'test';

const db = require('../src/config/db');
const logger = require('../src/config/logger');
const server = require('../src/app');

const adminRow = { rows: [{ user_id: 'admin-1', email: 'admin@matchr.in', role: 'superadmin' }] };

/** Every INSERT the middleware made into admin_audit_log. */
const auditInserts = () => db.query.mock.calls.filter(([sql]) => /INSERT INTO admin_audit_log/.test(sql));

/**
 * The finish hook fires after the response is sent, so the assertion has to
 * wait a tick or it races the write.
 */
const settle = () => new Promise((r) => setImmediate(r));

// clearAllMocks clears call history but NOT queued mockResolvedValueOnce
// values, so an unconsumed queue from one case would be read by the next.
beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.getClient.mockReset();
});
afterAll(async () => { if (server?.close) await new Promise((r) => server.close(r)); });

describe('admin audit middleware', () => {
  it('writes one row per mutation, with the action from the route pattern', async () => {
    db.query
      .mockResolvedValueOnce(adminRow)
      .mockResolvedValueOnce({ rows: [{ id: 'u-9', banned: true, banned_at: new Date(), banned_reason: 'spam' }] })
      .mockResolvedValue({ rows: [{ id: 1 }] });

    await request(server).post('/api/admin/users/u-9/ban').send({ reason: 'spamming every match' });
    await settle();

    const inserts = auditInserts();
    expect(inserts).toHaveLength(1);
    const [, params] = inserts[0];
    // The interpolated URL would be '/api/admin/users/u-9/ban'; the pattern is
    // what makes the action column groupable.
    expect(params[2]).toBe('user.ban');
    expect(params[4]).toBe('u-9');
    expect(params[5]).toBe('spamming every match');
    expect(params[9]).toBe(200);
  });

  it('derives an action name from the route pattern when a handler sets none', async () => {
    const { record } = require('../src/services/adminAudit');
    const adminAudit = require('../src/middleware/adminAudit');
    const listeners = {};
    const req = {
      method: 'POST',
      admin: { id: 'admin-1', email: 'a@b.c' },
      baseUrl: '/api/admin/users',
      route: { path: '/:userId/ban' },
      originalUrl: '/api/admin/users/u-9/ban?x=1',
      params: { userId: 'u-9' },
      query: {},
      body: {},
      headers: {},
    };
    const res = { statusCode: 204, on: (evt, fn) => { listeners[evt] = fn; } };

    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    adminAudit(req, res, () => {});
    listeners.finish();
    await settle();

    expect(db.query.mock.calls[0][1][2]).toBe('POST /api/admin/users/:userId/ban');
    expect(record).toBeDefined();
  });

  it('writes nothing for a GET', async () => {
    db.query
      .mockResolvedValueOnce(adminRow)
      .mockResolvedValueOnce({ rows: [{ total_users: '1' }] });

    await request(server).get('/api/admin/stats');
    await settle();
    expect(auditInserts()).toHaveLength(0);
  });

  it('still records a failed action, with the real status', async () => {
    db.query
      .mockResolvedValueOnce(adminRow)
      .mockResolvedValueOnce({ rows: [] })            // user not found
      .mockResolvedValue({ rows: [{ id: 1 }] });

    const res = await request(server).post('/api/admin/users/ghost/ban').send({ reason: 'not a real user' });
    await settle();

    expect(res.status).toBe(404);
    expect(auditInserts()[0][1][9]).toBe(404);
  });

  it('records a 422 from validation, before any handler ran', async () => {
    db.query.mockResolvedValueOnce(adminRow).mockResolvedValue({ rows: [{ id: 1 }] });

    const res = await request(server).post('/api/admin/users/u-9/ban').send({ reason: 'no' });
    await settle();

    expect(res.status).toBe(422);
    expect(auditInserts()[0][1][9]).toBe(422);
  });

  it('never lets an audit failure change the response', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    db.query
      .mockResolvedValueOnce(adminRow)
      .mockResolvedValueOnce({ rows: [{ id: 'u-9', banned: true }] })
      .mockRejectedValueOnce(new Error('audit table is on fire'));

    const res = await request(server).post('/api/admin/users/u-9/ban').send({ reason: 'spamming every match' });
    await settle();

    // The response was already sent; turning this into a 500 would be worse
    // than losing the row, so it is logged loudly and swallowed.
    expect(res.status).toBe(200);
    expect(errorSpy).toHaveBeenCalledWith(expect.anything(), '[audit] write failed');
    errorSpy.mockRestore();
  });
});

describe('audit redaction', () => {
  const { redact } = require('../src/services/adminAudit');

  it('strips secrets and message plaintext', () => {
    const out = redact({
      reason: 'ok',
      password: 'hunter2',
      access_token: 'ey...',
      content: 'the actual private message',
      nested: { service_role_key: 'sk_live', expo_push_token: 'ExponentPushToken[x]' },
    });

    expect(out.reason).toBe('ok');
    expect(out.password).toBe('[redacted]');
    expect(out.access_token).toBe('[redacted]');
    expect(out.content).toBe('[redacted]');
    expect(out.nested.service_role_key).toBe('[redacted]');
    expect(out.nested.expo_push_token).toBe('[redacted]');
  });

  it('truncates a long array rather than storing all of it', () => {
    const out = redact({ ids: Array.from({ length: 120 }, (_, i) => `u-${i}`) });
    expect(out.ids).toHaveLength(51);
    expect(out.ids[50]).toBe('…+70 more');
  });

  it('replaces oversized metadata instead of writing it', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });
    const { record } = require('../src/services/adminAudit');
    await record({ adminId: 'a', action: 'x', metadata: { blob: 'y'.repeat(20_000) } });

    const written = JSON.parse(db.query.mock.calls[0][1][6]);
    expect(written).toMatchObject({ truncated: true });
    expect(written.blob).toBeUndefined();
  });
});

describe('audit ip normalisation', () => {
  const { clientIp } = require('../src/services/adminAudit');

  it('unwraps an IPv4-mapped IPv6 address', () => {
    expect(clientIp({ ip: '::ffff:10.0.0.1' })).toBe('10.0.0.1');
  });

  it('passes a real IPv6 address through', () => {
    expect(clientIp({ ip: '2001:db8::1' })).toBe('2001:db8::1');
  });

  it('returns null rather than letting junk reach an INET column', () => {
    expect(clientIp({ ip: 'not-an-ip' })).toBeNull();
    expect(clientIp({})).toBeNull();
  });
});
