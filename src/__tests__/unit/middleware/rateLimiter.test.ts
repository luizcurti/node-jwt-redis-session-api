import express, { Express } from 'express';
import { Redis } from 'ioredis';
import request from 'supertest';
import {
  createLoginRateLimiter,
  createUsernameRateLimiter,
} from '../../../middleware/rateLimiter';

function buildApp(overrides: Parameters<typeof createLoginRateLimiter>[0]) {
  const app: Express = express();
  app.post('/login', createLoginRateLimiter(overrides), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('createLoginRateLimiter', () => {
  it('allows requests under the limit', async () => {
    const app = buildApp({ windowMs: 1000, max: 2, skip: () => false });

    await request(app).post('/login').expect(200);
    await request(app).post('/login').expect(200);
  });

  it('blocks requests over the limit with 429', async () => {
    const app = buildApp({ windowMs: 1000, max: 2, skip: () => false });

    await request(app).post('/login').expect(200);
    await request(app).post('/login').expect(200);
    const res = await request(app).post('/login');

    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      error: 'Too many login attempts. Please try again later.',
    });
  });

  it('is skipped by default when NODE_ENV is test', async () => {
    const app = buildApp({ windowMs: 1000, max: 1 });

    await request(app).post('/login').expect(200);
    await request(app).post('/login').expect(200);
    await request(app).post('/login').expect(200);
  });
});

describe('createUsernameRateLimiter', () => {
  let redisClient: { incr: jest.Mock; expire: jest.Mock };

  function buildUsernameApp(
    overrides: Parameters<typeof createUsernameRateLimiter>[1]
  ) {
    const app: Express = express();
    app.use(express.json());
    app.post(
      '/login',
      createUsernameRateLimiter(redisClient as unknown as Redis, overrides),
      (_req, res) => {
        res.status(200).json({ ok: true });
      }
    );
    return app;
  }

  beforeEach(() => {
    redisClient = { incr: jest.fn(), expire: jest.fn() };
  });

  it('is skipped by default when NODE_ENV is test', async () => {
    const app = buildUsernameApp({ max: 1 });

    await request(app).post('/login').send({ username: 'alice' }).expect(200);
    await request(app).post('/login').send({ username: 'alice' }).expect(200);
    expect(redisClient.incr).not.toHaveBeenCalled();
  });

  it('skips rate limiting when no username is present in the body', async () => {
    const app = buildUsernameApp({ max: 1, skipInTest: false });

    await request(app).post('/login').send({}).expect(200);
    expect(redisClient.incr).not.toHaveBeenCalled();
  });

  it('increments a normalized per-username Redis key and sets a TTL on first attempt', async () => {
    const app = buildUsernameApp({
      max: 5,
      windowSeconds: 900,
      skipInTest: false,
    });
    redisClient.incr.mockResolvedValueOnce(1);

    await request(app)
      .post('/login')
      .send({ username: '  Alice@Example.com  ' })
      .expect(200);

    expect(redisClient.incr).toHaveBeenCalledWith(
      'login:user:alice@example.com'
    );
    expect(redisClient.expire).toHaveBeenCalledWith(
      'login:user:alice@example.com',
      900
    );
  });

  it('does not reset the TTL on subsequent attempts within the window', async () => {
    const app = buildUsernameApp({ max: 5, skipInTest: false });
    redisClient.incr.mockResolvedValueOnce(2);

    await request(app).post('/login').send({ username: 'alice' }).expect(200);

    expect(redisClient.expire).not.toHaveBeenCalled();
  });

  it('blocks requests over the limit with 429', async () => {
    const app = buildUsernameApp({ max: 2, skipInTest: false });
    redisClient.incr.mockResolvedValueOnce(3);

    const res = await request(app).post('/login').send({ username: 'alice' });

    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      error:
        'Too many login attempts for this account. Please try again later.',
    });
  });
});
