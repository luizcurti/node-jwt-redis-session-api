import { Redis } from 'ioredis';
import { Request, RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator, Options } from 'express-rate-limit';
import RedisStore, { RedisReply } from 'rate-limit-redis';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 10;
// Session ids are UUIDs (36 chars); anything much longer is not a real one,
// and shouldn't become an arbitrarily long Redis key.
const MAX_SESSION_ID_LENGTH = 64;

// Backed by Redis, not the default in-memory store — a MemoryStore counts
// per Node process, so behind a load balancer an attacker gets `max`
// attempts *per instance* instead of `max` total. Generic per-IP limiter;
// callers override `windowMs`/`max`/`handler`/`keyGenerator` for their own
// endpoint. Never skipped based on NODE_ENV: tests get the real middleware
// chain with their own limits, injected through createApp().
export function createRedisRateLimiter(
  redisClient: Redis,
  overrides: Partial<Options>,
  storePrefix: string
): RequestHandler {
  return rateLimit({
    windowMs: DEFAULT_WINDOW_MS,
    max: DEFAULT_MAX_ATTEMPTS,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      prefix: storePrefix,
      sendCommand: (...args: string[]) =>
        (redisClient.call as (...args: string[]) => Promise<RedisReply>)(
          ...args
        ),
    }),
    handler: (_request, response) => {
      response
        .status(429)
        .json({ error: 'Too many requests. Please try again later.' });
    },
    ...overrides,
  });
}

// Keys the refresh limiter by the session the refresh token names, not by
// client IP: many legitimate users behind one office NAT/mobile CGNAT IP all
// refresh every 15 minutes, and a per-IP limit would log them out together.
// The validator half is a 256-bit secret, so per-session limiting is what
// actually matters; requests without a parseable token fall back to the IP
// (and every request still passes the per-IP baseline limiter first).
export function refreshTokenSessionKey(request: Request): string {
  const token: unknown = request.body?.refreshToken;

  if (typeof token === 'string') {
    const separatorIndex = token.indexOf('.');

    if (separatorIndex > 0 && separatorIndex <= MAX_SESSION_ID_LENGTH) {
      return `session:${token.slice(0, separatorIndex)}`;
    }
  }

  return `ip:${ipKeyGenerator(request.ip ?? '')}`;
}
