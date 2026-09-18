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
jest.mock('../src/services/userDeletion', () => ({
  hardDeleteUser: jest.fn().mockResolvedValue({ deleted: true }),
  softDeleteUser: jest.fn().mockResolvedValue({ deleted: true }),
  restoreUser: jest.fn().mockResolvedValue({ restored: true }),
  removeUserUploads: jest.fn(),
}));

process.env.PORT = '0';
process.env.NODE_ENV = 'test';

const db = require('../src/config/db');
const { endSessions } = require('../src/utils/sessions');
const userDeletion = require('../src/services/userDeletion');
const server = require('../src/app');

const admin = (role = 'superadmin') => ({ rows: [{ user_id: 'admin-1', email: 'a@b.c', role }] });
const settle = () => new Promise((r) => setImmediate(r));

/** The SQL of the first call that is neither the admin lookup nor an audit write. */
function mainQuery() {
  const call = db.query.mock.calls.find(
    ([sql]) => !/FROM admin_users/.test(sql) && !/admin_audit_log/.test(sql)
  );
  return { sql: call?.[0] ?? '', params: call?.[1] ?? [] };
}

// clearAllMocks clears call history but NOT queued mockResolvedValueOnce
// values, so an unconsumed queue from one case would be read by the next.
beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.getClient.mockReset();
});
afterAll(async () => { if (server?.close) await new Promise((r) => server.close(r)); });

describe('user list filters', () => {
  const list = (qs = '') => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    return request(server).get(`/api/admin/users${qs}`);
  };

  it('hides soft-deleted users by default', async () => {
    await list();
    expect(mainQuery().sql).toMatch(/u\.deleted_at IS NULL/);
  });

  it('includes them on request', async () => {
    await list('?include_deleted=true');
    expect(mainQuery().sql).not.toMatch(/u\.deleted_at IS NULL/);
  });

  it('binds the role rather than interpolating it', async () => {
    await list('?role=brand');
    const { sql, params } = mainQuery();
    expect(sql).toMatch(/u\.role = \$\d+::user_role/);
    expect(params).toContain('brand');
  });

  it('escapes LIKE wildcards so a search for _ does not match everything', async () => {
    await list('?search=a%5Fb');
    expect(mainQuery().params).toContain('%a\\_b%');
  });

  it('rejects a one-character search that would defeat the trigram index', async () => {
    const res = await list('?search=a');
    expect(res.status).toBe(422);
  });

  it('rejects a sort column that is not in the whitelist', async () => {
    const res = await list('?sort=name;DROP TABLE users');
    expect(res.status).toBe(422);
  });

  it('uses row-comparison keyset paging on the default sort', async () => {
    const cursor = Buffer.from('2026-01-01T00:00:00.000Z|u-5', 'utf8').toString('base64url');
    await list(`?cursor=${cursor}`);
    const { sql, params } = mainQuery();
    expect(sql).toMatch(/\(u\.created_at, u\.id\) < \(/);
    expect(params).toContain('u-5');
  });

  it('rejects a malformed cursor instead of silently ignoring it', async () => {
    const res = await list('?cursor=not-a-cursor');
    expect(res.status).toBe(422);
  });

  it('falls back to offset paging on a non-unique sort, and says so', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server).get('/api/admin/users?sort=name');
    expect(res.body.pagination).toBe('offset');
    expect(mainQuery().sql).toMatch(/OFFSET/);
  });

  it('caps the offset rather than letting a deep page scan the table', async () => {
    const res = await list('?sort=name&offset=99999');
    expect(res.status).toBe(422);
  });
});

describe('ban', () => {
  it('records who, when and why, and ends the sessions', async () => {
    db.query
      .mockResolvedValueOnce(admin())
      .mockResolvedValueOnce({ rows: [{ id: 'u-9', banned: true, banned_at: new Date(), banned_reason: 'spam' }] })
      .mockResolvedValue({ rows: [{ id: 1 }] });

    const res = await request(server).post('/api/admin/users/u-9/ban').send({ reason: 'spamming every match' });

    expect(res.status).toBe(200);
    const { sql, params } = mainQuery();
    expect(sql).toMatch(/banned_at = now\(\)/);
    expect(sql).toMatch(/banned_by = \$2/);
    expect(sql).toMatch(/banned_reason = \$3/);
    expect(params).toEqual(['u-9', 'admin-1', 'spamming every match']);
    expect(endSessions).toHaveBeenCalledWith(['u-9']);
  });

  it('requires a reason', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server).post('/api/admin/users/u-9/ban').send({});
    expect(res.status).toBe(422);
  });

  it('unban does not try to disconnect a socket that cannot exist', async () => {
    db.query
      .mockResolvedValueOnce(admin())
      .mockResolvedValueOnce({ rows: [{ id: 'u-9', banned: false }] })
      .mockResolvedValue({ rows: [{ id: 1 }] });

    await request(server).post('/api/admin/users/u-9/unban').send({});
    expect(endSessions).toHaveBeenCalledWith(['u-9'], { disconnect: false });
  });
});

describe('delete', () => {
  it('is soft by default', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [{ id: 1 }] });
    const res = await request(server).delete('/api/admin/users/u-9').send({ reason: 'duplicate account' });

    expect(res.body).toEqual({ deleted: 'soft' });
    expect(userDeletion.softDeleteUser).toHaveBeenCalled();
    expect(userDeletion.hardDeleteUser).not.toHaveBeenCalled();
  });

  it('refuses a hard delete to a role without users:delete', async () => {
    db.query.mockResolvedValueOnce(admin('moderator')).mockResolvedValue({ rows: [{ id: 1 }] });
    const res = await request(server).delete('/api/admin/users/u-9?hard=true').send({ reason: 'a good clear reason' });

    expect(res.status).toBe(403);
    expect(res.body.required_permission).toBe('users:delete');
    expect(userDeletion.hardDeleteUser).not.toHaveBeenCalled();
  });

  it('runs the shared pipeline on a hard delete, and audits before acting', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [{ id: 7, created_at: new Date() }] });
    const res = await request(server).delete('/api/admin/users/u-9?hard=true').send({ reason: 'confirmed fake account' });

    expect(res.body).toEqual({ deleted: 'hard' });
    // The pipeline that also removes Supabase Storage objects and the auth
    // identity — the admin route used to be a bare DELETE FROM users.
    expect(userDeletion.hardDeleteUser).toHaveBeenCalledWith('u-9', {
      actorId: 'admin-1', reason: 'confirmed fake account',
    });

    const inserts = db.query.mock.calls.filter(([sql]) => /INSERT INTO admin_audit_log/.test(sql));
    expect(inserts[0][1][2]).toBe('user.hard_delete');
  });

  it('demands a longer reason than a ban does', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server).delete('/api/admin/users/u-9').send({ reason: 'dupe' });
    expect(res.status).toBe(422);
  });
});

describe('bulk ban', () => {
  it('rejects more ids than the documented maximum', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server)
      .post('/api/admin/users/bulk-ban')
      .send({ userIds: Array.from({ length: 501 }, (_, i) => `u-${i}`), reason: 'coordinated spam ring' });

    // 422 from the validator, not a 413 from the body parser happening to be
    // the thing that stopped it.
    expect(res.status).toBe(422);
  });

  it('reports which ids did not exist', async () => {
    db.query
      .mockResolvedValueOnce(admin())
      .mockResolvedValueOnce({ rows: [{ id: 'u-1' }] })
      .mockResolvedValue({ rows: [{ id: 1 }] });

    const res = await request(server)
      .post('/api/admin/users/bulk-ban')
      .send({ userIds: ['u-1', 'u-ghost'], reason: 'coordinated spam ring' });

    expect(res.body).toMatchObject({ affected: 1, missing: ['u-ghost'] });
  });
});

describe('CSV export', () => {
  const { escapeCell } = require('../src/utils/csv');

  it('neutralises a formula so a bio cannot execute in Excel', () => {
    expect(escapeCell('=HYPERLINK("http://evil","click")')).toBe('"\'=HYPERLINK(""http://evil"",""click"")"');
    expect(escapeCell('+1-555')).toBe('"\'+1-555"');
    expect(escapeCell('@someone')).toBe('"\'@someone"');
  });

  it('doubles embedded quotes', () => {
    expect(escapeCell('she said "hi"')).toBe('"she said ""hi"""');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeCell('Acme Coffee')).toBe('"Acme Coffee"');
  });

  it('streams with a download filename and no caching', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    const res = await request(server).get('/api/admin/users/export.csv');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="matchr-users-/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('is not reachable by a role without users:export', async () => {
    db.query.mockResolvedValueOnce(admin('moderator')).mockResolvedValue({ rows: [] });
    const res = await request(server).get('/api/admin/users/export.csv');
    expect(res.status).toBe(403);
  });

  it('audits the export even though it is a GET', async () => {
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [] });
    await request(server).get('/api/admin/users/export.csv?role=brand');
    await settle();

    const inserts = db.query.mock.calls.filter(([sql]) => /INSERT INTO admin_audit_log/.test(sql));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1][2]).toBe('user.export');
  });
});

describe('user detail', () => {
  it('never returns a push token or PostGIS coordinates', async () => {
    db.query
      .mockResolvedValueOnce(admin())
      .mockResolvedValueOnce({ rows: [{ id: 'u-9', email: 'x@y.z', role: 'brand', has_push_token: true }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'u-9', name: 'Acme', location_geog: '0101000020E61' }] })
      .mockResolvedValue({ rows: [{}] });

    const res = await request(server).get('/api/admin/users/u-9');

    expect(res.status).toBe(200);
    // A push token is a device address, so only its presence is exposed.
    expect(res.body.user.has_push_token).toBe(true);
    expect(res.body.user.expo_push_token).toBeUndefined();
    expect(res.body.profile.location_geog).toBeUndefined();
  });

  it('puts onboarding_data behind its own audited route', async () => {
    db.query
      .mockResolvedValueOnce(admin())
      .mockResolvedValueOnce({ rows: [{ onboarding_data: { step: 'photos' } }] })
      .mockResolvedValue({ rows: [{ id: 1 }] });

    await request(server).get('/api/admin/users/u-9/onboarding');
    await settle();

    const inserts = db.query.mock.calls.filter(([sql]) => /INSERT INTO admin_audit_log/.test(sql));
    expect(inserts[0][1][2]).toBe('user.onboarding_read');
  });
});

describe('profile edit', () => {
  it('refuses to write measured fields', async () => {
    db.query
      .mockResolvedValueOnce(admin())
      .mockResolvedValueOnce({ rows: [{ id: 'u-9', role: 'influencer' }] })
      .mockResolvedValue({ rows: [] });

    const res = await request(server)
      .patch('/api/admin/users/u-9')
      .send({ followers: 999999, verified: true, reason: 'customer asked nicely' });

    // followers and verified come from Instagram sync and face verification.
    // The product deliberately hides unmeasured audience numbers rather than
    // showing a typed-in one as if it were a measurement.
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/No editable fields/);
  });
});
