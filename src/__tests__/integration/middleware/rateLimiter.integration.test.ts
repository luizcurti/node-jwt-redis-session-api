import express, { Express } from 'express';
import request from 'supertest';
import {
  createRedisRateLimiter,
  refreshTokenSessionKey,
} from '../../../middleware/rateLimiter';
import {
  closeTestConnections,
  resetCache,
  testRedisClient,
} from '../../testSetup/testDb';

function buildApp(overrides: Parameters<typeof createRedisRateLimiter>[1]) {
  const app: Express = express();
  app.post(
    '/login',
    createRedisRateLimiter(testRedisClient, overrides, 'rl:ip:test:'),
    (_req, res) => {
      res.status(200).json({ ok: true });
    }
  );
  return app;
}

describe('createRedisRateLimiter (integration, real Redis)', () => {
  beforeEach(async () => {
    await resetCache();
  });

  afterAll(async () => {
    await closeTestConnections();
  });

  it('allows requests under the limit', async () => {
    const app = buildApp({ windowMs: 1000, max: 2 });

    await request(app).post('/login').expect(200);
    await request(app).post('/login').expect(200);
  });

  it('blocks requests over the limit with 429, counted via Redis', async () => {
    const app = buildApp({ windowMs: 60_000, max: 2 });

    await request(app).post('/login').expect(200);
    await request(app).post('/login').expect(200);
    const res = await request(app).post('/login');

    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      error: 'Too many requests. Please try again later.',
    });
  });

  it('shares the count across separate limiter instances pointed at the same Redis (i.e. across app replicas)', async () => {
    // Two separate `rateLimit()` instances, as two app processes behind a
    // load balancer would each construct their own — the point of a shared
    // Redis store is that they still count against the same limit.
    const appReplicaA = buildApp({ windowMs: 60_000, max: 2 });
    const appReplicaB = buildApp({ windowMs: 60_000, max: 2 });

    await request(appReplicaA).post('/login').expect(200);
    await request(appReplicaB).post('/login').expect(200);
    const res = await request(appReplicaA).post('/login');

    expect(res.statusCode).toBe(429);
  });

  it('is NOT skipped under NODE_ENV=test — tests inject their own limits instead', async () => {
    expect(process.env.NODE_ENV).toBe('test');
    const app = buildApp({ windowMs: 60_000, max: 1 });

    await request(app).post('/login').expect(200);
    await request(app).post('/login').expect(429);
  });

  it('keys the refresh limiter per session, so many sessions behind one IP do not share a bucket', async () => {
    const app: Express = express();
    app.use(express.json());
    app.post(
      '/refresh',
      createRedisRateLimiter(
        testRedisClient,
        { windowMs: 60_000, max: 1, keyGenerator: refreshTokenSessionKey },
        'rl:refresh:'
      ),
      (_req, res) => {
        res.status(200).json({ ok: true });
      }
    );

    await request(app)
      .post('/refresh')
      .send({ refreshToken: 'session-a.v' })
      .expect(200);
    // Same IP, different session: its own bucket.
    await request(app)
      .post('/refresh')
      .send({ refreshToken: 'session-b.v' })
      .expect(200);
    // Same session again: over its limit.
    await request(app)
      .post('/refresh')
      .send({ refreshToken: 'session-a.v2' })
      .expect(429);
  });
});
