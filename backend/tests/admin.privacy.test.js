const request = require('supertest');

jest.mock('../src/utils/sharedCache', () => ({
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  redisReady: () => false,
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: req.headers['x-test-user'] || 'admin-1', email: 'a@b.c' }; next(); },
  authenticateTokenOnly: (req, _res, next) => { req.user = { id: req.headers['x-test-user'] || 'admin-1', email: 'a@b.c' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

// A shared call recorder. The single most important property of this whole
// design is that the audit row is written BEFORE anything is decrypted, and
// the only way to assert an ordering across two modules is to have both write
// into the same log.
const calls = [];
jest.mock('../src/utils/encryption', () => ({
  encrypt: jest.fn(),
  decrypt: jest.fn((c) => { calls.push('decrypt'); return `plain:${c}`; }),
}));

process.env.PORT = '0';
process.env.NODE_ENV = 'test';

const db = require('../src/config/db');
const { decrypt } = require('../src/utils/encryption');
const server = require('../src/app');

const MATCH = '11111111-1111-4111-8111-111111111111';
const MSG = '22222222-2222-4222-8222-222222222222';
const REPORT = '33333333-3333-4333-8333-333333333333';

const admin = (role) => ({ rows: [{ user_id: 'admin-1', email: 'a@b.c', role }] });

/** db.query that logs an audit insert into the shared recorder. */
function trackAuditWrites() {
  db.query.mockImplementation((sql) => {
    if (/INSERT INTO admin_audit_log/.test(sql)) {
      calls.push('audit');
      return Promise.resolve({ rows: [{ id: 42, created_at: new Date() }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => { jest.clearAllMocks(); calls.length = 0; });
afterAll(async () => { if (server?.close) await new Promise((r) => server.close(r)); });

describe('full conversation reader', () => {
  it('is closed to a moderator', async () => {
    db.query.mockResolvedValueOnce(admin('moderator'));
    const res = await request(server)
      .get(`/api/admin/matches/${MATCH}/messages?reason=investigating+a+harassment+report`);

    expect(res.status).toBe(403);
    expect(res.body.required_permission).toBe('messages:read');
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('refuses a superadmin with no reason', async () => {
    db.query.mockResolvedValueOnce(admin('superadmin'));
    const res = await request(server).get(`/api/admin/matches/${MATCH}/messages`);
    expect(res.status).toBe(422);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('refuses a reason too short to mean anything', async () => {
    db.query.mockResolvedValueOnce(admin('superadmin'));
    const res = await request(server).get(`/api/admin/matches/${MATCH}/messages?reason=because`);
    expect(res.status).toBe(422);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('writes the audit row BEFORE it decrypts anything', async () => {
    db.query
      .mockResolvedValueOnce(admin('superadmin'))
      .mockResolvedValueOnce({ rows: [{ id: MATCH, brand_id: 'b-1', influencer_id: 'i-1' }] })
      .mockResolvedValueOnce({
        rows: [{ id: MSG, sender_id: 'b-1', content: 'cipher', created_at: new Date(), read_at: null }],
      })
      .mockImplementation((sql) => {
        if (/INSERT INTO admin_audit_log/.test(sql)) {
          calls.push('audit');
          return Promise.resolve({ rows: [{ id: 42, created_at: new Date() }] });
        }
        return Promise.resolve({ rows: [] });
      });

    const res = await request(server)
      .get(`/api/admin/matches/${MATCH}/messages?reason=investigating+a+harassment+report`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].content).toBe('plain:cipher');
    // This ordering is the property the whole privacy model rests on: if the
    // process dies mid-handler, what was about to be revealed is already durable.
    expect(calls.indexOf('audit')).toBeLessThan(calls.indexOf('decrypt'));
  });

  it('names every revealed message id in the audit metadata, and no plaintext', async () => {
    db.query
      .mockResolvedValueOnce(admin('superadmin'))
      .mockResolvedValueOnce({ rows: [{ id: MATCH, brand_id: 'b-1', influencer_id: 'i-1' }] })
      .mockResolvedValueOnce({
        rows: [{ id: MSG, sender_id: 'b-1', content: 'cipher', created_at: new Date(), read_at: null }],
      })
      .mockResolvedValue({ rows: [{ id: 42, created_at: new Date() }] });

    await request(server).get(`/api/admin/matches/${MATCH}/messages?reason=investigating+a+harassment+report`);

    const insert = db.query.mock.calls.find(([sql]) => /INSERT INTO admin_audit_log/.test(sql));
    const metadata = JSON.parse(insert[1][6]);
    expect(metadata.message_ids).toEqual([MSG]);
    expect(JSON.stringify(metadata)).not.toContain('plain:');
    expect(JSON.stringify(metadata)).not.toContain('cipher');
  });
});

describe('timeline', () => {
  it('returns shape without ever decrypting', async () => {
    db.query
      .mockResolvedValueOnce(admin('moderator'))
      .mockResolvedValueOnce({
        rows: [{ id: MSG, sender_id: 'b-1', created_at: new Date(), read_at: null, cipher_length: '88' }],
      });

    const res = await request(server).get(`/api/admin/matches/${MATCH}/timeline`);

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ id: MSG, cipher_length: 88 });
    expect(res.body.data[0].content).toBeUndefined();
    expect(decrypt).not.toHaveBeenCalled();
  });
});

describe('report queue', () => {
  it('never returns message content, only that content exists', async () => {
    db.query
      .mockResolvedValueOnce(admin('moderator'))
      .mockResolvedValueOnce({
        rows: [{
          id: REPORT, reporter_id: null, target_type: 'message', target_id: MSG,
          reason: 'harassment', status: 'open', created_at: new Date(),
          prior_reports_against_target: 0,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: MSG, match_id: MATCH, sender_id: 'b-1', created_at: new Date(), cipher_length: '88' }] });

    const res = await request(server).get('/api/admin/reports');

    expect(res.status).toBe(200);
    expect(res.body.data[0].target).toMatchObject({ content: null, content_available: true });
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('never casts a non-UUID target id to uuid', async () => {
    db.query
      .mockResolvedValueOnce(admin('moderator'))
      .mockResolvedValueOnce({
        rows: [{
          id: REPORT, reporter_id: null, target_type: 'post', target_id: 'definitely-not-a-uuid',
          reason: 'spam', status: 'open', created_at: new Date(), prior_reports_against_target: 0,
        }],
      })
      .mockResolvedValue({ rows: [] });

    const res = await request(server).get('/api/admin/reports');

    expect(res.status).toBe(200);
    // The id is filtered out before the cast, so the array reaching Postgres is
    // empty. Passing it through would fail the page with a 22P02.
    const cast = db.query.mock.calls.find(([sql]) => /uuid\[\]/.test(sql));
    if (cast) expect(cast[1][0]).toEqual([]);
    expect(res.body.data[0].target).toEqual({ deleted: true });
  });

  it('reports already-removed content as deleted rather than null', async () => {
    db.query
      .mockResolvedValueOnce(admin('moderator'))
      .mockResolvedValueOnce({
        rows: [{
          id: REPORT, reporter_id: null, target_type: 'post', target_id: MSG,
          reason: 'spam', status: 'open', created_at: new Date(), prior_reports_against_target: 2,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(server).get('/api/admin/reports');
    expect(res.body.data[0].target).toEqual({ deleted: true });
  });
});

describe('message context window', () => {
  it('audits before decrypting and caps the window', async () => {
    const neighbours = Array.from({ length: 11 }, (_, i) => ({
      id: `4444444${i}-4444-4444-8444-444444444444`,
      match_id: MATCH,
      sender_id: i % 2 ? 'b-1' : 'i-1',
      content: `cipher-${i}`,
      created_at: new Date(Date.now() + i * 1000),
      is_target: i === 5,
    }));

    db.query
      .mockResolvedValueOnce(admin('moderator'))
      .mockResolvedValueOnce({ rows: [{ id: REPORT, target_type: 'message', target_id: MSG }] })
      .mockResolvedValueOnce({ rows: neighbours })
      .mockImplementation((sql) => {
        if (/INSERT INTO admin_audit_log/.test(sql)) {
          calls.push('audit');
          return Promise.resolve({ rows: [{ id: 42, created_at: new Date() }] });
        }
        return Promise.resolve({ rows: [] });
      });

    const res = await request(server).get(`/api/admin/reports/${REPORT}/message-context`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(11);
    expect(res.body.window).toBe(5);
    expect(calls.indexOf('audit')).toBeLessThan(calls.indexOf('decrypt'));
  });

  it('422s a report that does not point at a message', async () => {
    db.query
      .mockResolvedValueOnce(admin('moderator'))
      .mockResolvedValueOnce({ rows: [{ id: REPORT, target_type: 'user', target_id: 'u-1' }] });

    const res = await request(server).get(`/api/admin/reports/${REPORT}/message-context`);
    expect(res.status).toBe(422);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('survives a message it cannot decrypt', async () => {
    decrypt.mockImplementationOnce(() => { throw new Error('bad key'); });
    db.query
      .mockResolvedValueOnce(admin('moderator'))
      .mockResolvedValueOnce({ rows: [{ id: REPORT, target_type: 'message', target_id: MSG }] })
      .mockResolvedValueOnce({
        rows: [{ id: MSG, match_id: MATCH, sender_id: 'b-1', content: 'x', created_at: new Date(), is_target: true }],
      })
      .mockResolvedValue({ rows: [{ id: 42, created_at: new Date() }] });

    const res = await request(server).get(`/api/admin/reports/${REPORT}/message-context`);
    expect(res.status).toBe(200);
    expect(res.body.messages[0].content).toBe('[could not decrypt]');
  });
});
