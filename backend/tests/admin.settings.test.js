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
const feedRanking = require('../src/services/feedRanking');
const maintenanceMode = require('../src/middleware/maintenanceMode');
const server = require('../src/app');

const admin = (role = 'superadmin') => ({ rows: [{ user_id: 'admin-1', email: 'a@b.c', role }] });
const weights = (over = {}) => ({
  CATEGORY_OVERLAP: 40, BUDGET_FIT: 30, LOCATION_MATCH: 20, COMPLETENESS: 10, ...over,
});

const put = (key, value) => {
  db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [{ key, value }] });
  return request(server).put(`/api/admin/settings/${key}`).send({ value });
};

beforeEach(() => {
  jest.clearAllMocks();
  maintenanceMode._set({ enabled: false });
});
afterAll(async () => {
  maintenanceMode._set({ enabled: false });
  if (server?.close) await new Promise((r) => server.close(r));
});

describe('algorithm weights', () => {
  it('accepts a set that totals 100 and busts the ranking cache', async () => {
    const spy = jest.spyOn(feedRanking, 'invalidateWeights').mockResolvedValue();
    const res = await put('algorithm_weights', weights());

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rejects a set that does not total 100', async () => {
    // The old endpoint accepted any sum and feedRanking applied it verbatim,
    // so one typo could silently reweight the whole feed.
    const res = await put('algorithm_weights', weights({ CATEGORY_OVERLAP: 39 }));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/must total 100 \(got 99\)/);
  });

  it('rejects a negative weight', async () => {
    const res = await put('algorithm_weights', weights({ CATEGORY_OVERLAP: -500, BUDGET_FIT: 570 }));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/0 to 100/);
  });

  it('rejects a missing weight rather than coercing it to zero', async () => {
    const v = weights();
    delete v.COMPLETENESS;
    const res = await put('algorithm_weights', v);
    expect(res.status).toBe(422);
  });

  it('keeps working through the original /algorithm path', async () => {
    jest.spyOn(feedRanking, 'invalidateWeights').mockResolvedValue();
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [{ key: 'algorithm_weights', value: weights() }] });

    const res = await request(server).put('/api/admin/algorithm').send(weights());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ CATEGORY_OVERLAP: 40 });
  });
});

describe('feature flags', () => {
  it('accepts booleans under snake_case names', async () => {
    const res = await put('feature_flags', { premium_likes: true, new_onboarding: false });
    expect(res.status).toBe(200);
  });

  it('rejects a non-boolean value', async () => {
    const res = await put('feature_flags', { premium_likes: 'yes' });
    expect(res.status).toBe(422);
  });

  it('rejects a flag name that is not a safe identifier', async () => {
    const res = await put('feature_flags', { 'premium-likes': true });
    expect(res.status).toBe(422);
  });
});

describe('unknown keys', () => {
  it('404s rather than storing something nothing validates', async () => {
    const res = await put('arbitrary_key', { anything: 1 });
    expect(res.status).toBe(404);
  });
});

describe('maintenance mode', () => {
  it('503s ordinary API traffic when enabled', async () => {
    maintenanceMode._set({ enabled: true, message: 'Back at 9pm IST' });
    const res = await request(server).get('/api/feed');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'maintenance', error: 'Back at 9pm IST' });
    expect(res.headers['retry-after']).toBe('300');
  });

  it('leaves /health up so the platform probe keeps passing', async () => {
    maintenanceMode._set({ enabled: true });
    const res = await request(server).get('/health');
    expect(res.status).toBe(200);
  });

  it('leaves /api/admin up, or nobody could turn it back off', async () => {
    maintenanceMode._set({ enabled: true });
    db.query.mockResolvedValueOnce(admin()).mockResolvedValue({ rows: [{ total_users: '1' }] });

    const res = await request(server).get('/api/admin/stats');
    expect(res.status).toBe(200);
  });

  it('leaves /api/auth up so a signed-in user sees a notice, not a login loop', async () => {
    maintenanceMode._set({ enabled: true });
    const res = await request(server).get('/api/auth/me');
    expect(res.status).not.toBe(503);
  });

  it('fails open when the flag cannot be read', async () => {
    db.query.mockRejectedValue(new Error('database is unreachable'));
    await maintenanceMode.refresh();

    // A blip reading a switch used a handful of times a year must never be the
    // thing that takes the API down.
    const res = await request(server).get('/api/feed');
    expect(res.status).not.toBe(503);
  });

  it('never puts a query on the request path', async () => {
    jest.clearAllMocks();
    await request(server).get('/health');
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('rate limit configuration', () => {
  const { LIMITS } = require('../src/config/adminLimiters');

  it('caps conversation reads far below everything else', () => {
    expect(LIMITS.messages).toEqual({ windowMs: 3_600_000, max: 10 });
  });

  it('caps exports and broadcasts per hour', () => {
    expect(LIMITS.export.max).toBe(5);
    expect(LIMITS.broadcast.max).toBe(5);
  });

  it('counts failed admin attempts per IP so the API is not an admin oracle', () => {
    expect(LIMITS.authfail).toEqual({ windowMs: 600_000, max: 10 });
  });
});
