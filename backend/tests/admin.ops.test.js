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

jest.mock('../src/utils/sessions', () => ({ endSessions: jest.fn().mockResolvedValue() }));

// Sentinels: the system endpoint must never echo any of these back.
process.env.SUPABASE_SERVICE_ROLE_KEY = 'SENTINEL_SERVICE_ROLE_KEY_zzz';
process.env.DATABASE_URL = 'postgres://SENTINEL_DB_USER:SENTINEL_DB_PASS@localhost:5432/x';
process.env.ENCRYPTION_KEY = 'SENTINEL_ENCRYPTION_KEY_zzz';
process.env.PORT = '0';
process.env.NODE_ENV = 'test';

const db = require('../src/config/db');
const notificationService = require('../src/services/notificationService');
const server = require('../src/app');

const admin = (role = 'superadmin') => ({ rows: [{ user_id: 'admin-1', email: 'a@b.c', role }] });

// clearAllMocks clears call history but NOT queued mockResolvedValueOnce
// values, so an unconsumed queue from one case would be read by the next.
beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.getClient.mockReset();
});
afterAll(async () => { if (server?.close) await new Promise((r) => server.close(r)); });

describe('metrics', () => {
  it('counts exactly, with no reltuples estimate anywhere', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValueOnce({
      rows: [{ total_users: '120', total_brands: '40', banned_users: '2', open_reports: '3' }],
    });

    const res = await request(server).get('/api/admin/stats');

    expect(res.status).toBe(200);
    // reltuples is -1 on a never-analyzed table, so a fresh database used to
    // report total_users: -1.
    const sql = db.query.mock.calls[1][0];
    expect(sql).not.toMatch(/reltuples/);
    expect(res.body.total_users).toBe(120);
    expect(Object.values(res.body).every((v) => v >= 0)).toBe(true);
  });

  it('caps the time series range instead of scanning a decade', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server).get('/api/admin/metrics/timeseries?from=2020-01-01&to=2026-01-01');

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/max 366/);
  });

  it('rejects a from after a to', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server).get('/api/admin/metrics/timeseries?from=2026-02-01&to=2026-01-01');
    expect(res.status).toBe(422);
  });

  it('rejects a date that is not ISO', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server).get('/api/admin/metrics/timeseries?from=last-tuesday');
    expect(res.status).toBe(422);
  });

  it('binds the timezone rather than interpolating it into SQL', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    await request(server).get('/api/admin/metrics/timeseries?from=2026-01-01&to=2026-01-07&tz=America/New_York');

    const call = db.query.mock.calls.find(([sql]) => /generate_series/.test(sql));
    expect(call[0]).not.toContain('America/New_York');
    expect(call[1]).toContain('America/New_York');
  });

  it('defaults to IST, not the server timezone', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server).get('/api/admin/metrics/timeseries?from=2026-01-01&to=2026-01-07');

    // Railway runs UTC; bucketing on created_at::date would draw the day
    // boundary at 05:30 IST and make every chart dip overnight.
    expect(res.body.tz).toBe('Asia/Kolkata');
  });

  it('computes funnel percentages without dividing by zero', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValueOnce({
      rows: [{
        signed_up: '0', role_chosen: '0', onboarded: '0',
        first_swipe: '0', first_match: '0', first_message: '0',
      }],
    });

    const res = await request(server).get('/api/admin/metrics/funnel');

    expect(res.status).toBe(200);
    expect(res.body.stages).toHaveLength(6);
    expect(res.body.stages.every((s) => Number.isFinite(s.pct_of_start))).toBe(true);
    expect(res.body.stages.every((s) => Number.isFinite(s.pct_of_prev))).toBe(true);
  });

  it('rejects a breakdown dimension that is not in the fixed map', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server).get('/api/admin/metrics/breakdown?dimension=(SELECT 1)');
    expect(res.status).toBe(422);
  });
});

describe('broadcast segments', () => {
  const { buildSegmentWhere } = require('../src/services/adminSegments');

  it('rejects a field that is not whitelisted', () => {
    // An admin panel that accepts a WHERE clause is remote code execution
    // with extra steps.
    expect(() => buildSegmentWhere({ 'id; DROP TABLE users--': 1 })).toThrow(/Unknown segment field/);
    expect(() => buildSegmentWhere({ raw_sql: '1=1' })).toThrow(/Unknown segment field/);
  });

  it('binds every value it accepts', () => {
    const { sql, params } = buildSegmentWhere({ role: 'brand', location: 'Mumbai' });
    expect(sql).not.toContain('brand');
    expect(sql).not.toContain('Mumbai');
    expect(params).toEqual(expect.arrayContaining(['brand', '%Mumbai%']));
  });

  it('excludes banned users unless asked for them', () => {
    expect(buildSegmentWhere({}).sql).toMatch(/u\.banned = false/);
    expect(buildSegmentWhere({ banned: true }).sql).toMatch(/u\.banned = true/);
  });

  it('caps an explicit id list', () => {
    expect(() => buildSegmentWhere({ user_ids: Array.from({ length: 1001 }, (_, i) => `u-${i}`) }))
      .toThrow(/max 1000/);
  });

  it('escapes LIKE wildcards in a location', () => {
    expect(buildSegmentWhere({ location: 'a_b' }).params).toContain('%a\\_b%');
  });
});

describe('broadcast delivery', () => {
  it('previews without sending anything', async () => {
    db.query
      .mockResolvedValueOnce(admin())
      .mockResolvedValueOnce({ rows: [{ recipients: 42, with_push_token: 30 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(server).post('/api/admin/broadcast/preview').send({ segment: { role: 'brand' } });

    expect(res.status).toBe(200);
    expect(res.body.recipients).toBe(42);
    expect(notificationService.recordNotifications).not.toHaveBeenCalled();
    expect(notificationService.sendBulkNotifications).not.toHaveBeenCalled();
  });

  it('chunks a large send and marks every item as an announcement', async () => {
    const recipients = Array.from({ length: 1200 }, (_, i) => ({ id: `u-${i}` }));
    db.query
      .mockResolvedValueOnce(admin())
      .mockResolvedValueOnce({ rows: recipients })
      .mockResolvedValueOnce({ rows: [{ id: 'bc-1', created_at: new Date() }] })
      .mockResolvedValue({ rows: [{ id: 1, created_at: new Date() }] });

    const res = await request(server)
      .post('/api/admin/broadcast')
      .send({ segment: {}, title: 'New feature', body: 'Likes are live' });

    expect(res.status).toBe(200);
    expect(res.body.recipients).toBe(1200);
    expect(notificationService.sendBulkNotifications).toHaveBeenCalledTimes(3);

    const firstChunk = notificationService.sendBulkNotifications.mock.calls[0][0];
    expect(firstChunk).toHaveLength(500);
    // 'announcement' only became a legal notifications.type in 028; without
    // that widening every one of these inserts is a 23514.
    expect(firstChunk.every((i) => i.type === 'announcement')).toBe(true);
  });

  it('refuses a segment that matches nobody', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValueOnce({ rows: [] });
    const res = await request(server).post('/api/admin/broadcast').send({ title: 'x', body: 'y' });

    expect(res.status).toBe(422);
    expect(notificationService.sendBulkNotifications).not.toHaveBeenCalled();
  });

  it('turns a duplicate idempotency key into a 409 before anything is sent', async () => {
    const duplicate = Object.assign(new Error('duplicate key'), { code: '23505' });
    db.query
      .mockResolvedValueOnce(admin())
      .mockResolvedValueOnce({ rows: [{ id: 'u-1' }] })
      .mockRejectedValueOnce(duplicate);

    const res = await request(server)
      .post('/api/admin/broadcast')
      .send({ title: 'x', body: 'y', idempotency_key: 'same-key' });

    expect(res.status).toBe(409);
    expect(notificationService.sendBulkNotifications).not.toHaveBeenCalled();
  });
});

describe('system health', () => {
  const systemResponse = async (role = 'superadmin') => {
    db.query
      .mockResolvedValueOnce(admin(role))
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ filename: '028_admin_rbac_audit.sql', applied_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [{ applied: 28 }] });
    return request(server).get('/api/admin/system');
  };

  it('reports build, database, redis, queues and migrations', async () => {
    const res = await systemResponse();
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('build.commit');
    expect(res.body).toHaveProperty('database.pool');
    expect(res.body).toHaveProperty('redis');
    expect(res.body).toHaveProperty('queues');
    expect(res.body).toHaveProperty('migrations.latest_applied');
  });

  it('leaks no secret, connection string or environment', async () => {
    const res = await systemResponse();
    const body = JSON.stringify(res.body);

    for (const secret of ['SENTINEL_SERVICE_ROLE_KEY_zzz', 'SENTINEL_DB_PASS', 'SENTINEL_DB_USER', 'SENTINEL_ENCRYPTION_KEY_zzz']) {
      expect(body).not.toContain(secret);
    }
    expect(body).not.toMatch(/postgres:\/\//);
  });

  it('stays up when a dependency is down', async () => {
    db.query
      .mockResolvedValueOnce(admin())
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue({ rows: [] });

    const res = await request(server).get('/api/admin/system');

    // A health endpoint that 500s when something is unhealthy is useless
    // exactly when you need it.
    expect(res.status).toBe(200);
    expect(res.body.database.ok).toBe(false);
    expect(res.body.database.error).toMatch(/connection refused/);
  });

  it('is closed to a moderator', async () => {
    expect((await systemResponse('moderator')).status).toBe(403);
  });

  it('is open to an analyst, whose whole job is reading numbers', async () => {
    db.query.mockReset();
    expect((await systemResponse('analyst')).status).toBe(200);
  });
});

describe('report actions', () => {
  function mockClient(results) {
    const queue = [...results];
    const client = {
      query: jest.fn(() => Promise.resolve(queue.shift() ?? { rows: [] })),
      release: jest.fn(),
    };
    db.getClient.mockResolvedValue(client);
    return client;
  }

  const REPORT = '33333333-3333-4333-8333-333333333333';

  it('bans the target and commits, in one transaction', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [{ id: 1 }] });
    const client = mockClient([
      undefined,
      { rows: [{ id: REPORT, target_type: 'user', target_id: 'u-9', reporter_id: 'u-1' }] },
      { rowCount: 1 },
      { rowCount: 1 },
    ]);

    const res = await request(server)
      .post(`/api/admin/reports/${REPORT}/action`)
      .send({ action: 'ban_target', reason: 'repeated harassment' });

    expect(res.status).toBe(200);
    expect(res.body.effects).toEqual([{ type: 'user_banned', id: 'u-9', applied: true }]);
    expect(client.query.mock.calls.map(([s]) => s)).toContain('COMMIT');
  });

  it('requires a reason', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server).post(`/api/admin/reports/${REPORT}/action`).send({ action: 'dismiss' });
    expect(res.status).toBe(422);
  });

  it('rejects an action that is not in the list', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server)
      .post(`/api/admin/reports/${REPORT}/action`)
      .send({ action: 'delete_everything', reason: 'because I can' });
    expect(res.status).toBe(422);
  });

  it('caps a bulk action', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server).post('/api/admin/reports/bulk').send({
      report_ids: Array.from({ length: 101 }, () => REPORT),
      action: 'dismiss',
      reason: 'duplicate reports',
    });
    expect(res.status).toBe(422);
  });
});
