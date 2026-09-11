import { Redis } from 'ioredis';
import { RequestHandler } from 'express';
import rateLimit, { Options } from 'express-rate-limit';
import RedisStore, { RedisReply } from 'rate-limit-redis';
import { asyncHandler } from './asyncHandler';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_WINDOW_SECONDS = DEFAULT_WINDOW_MS / 1000;
const DEFAULT_MAX_ATTEMPTS = 10;

/**
 * Backed by Redis, not express-rate-limit's default in-memory store — a
 * MemoryStore counts per Node process, so behind a load balancer with
 * multiple app instances, an attacker gets `max` attempts *per instance*
 * instead of `max` total. A shared Redis store is what makes the limit
 * actually be a limit once this runs as more than one replica.
 */
export function createLoginRateLimiter(
  redisClient: Redis,
  overrides: Partial<Options> = {},
  storePrefix = 'rl:ip:login:'
): RequestHandler {
  return rateLimit({
    windowMs: DEFAULT_WINDOW_MS,
    max: DEFAULT_MAX_ATTEMPTS,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
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
        .json({ error: 'Too many login attempts. Please try again later.' });
    },
    ...overrides,
  });
}

export type UsernameRateLimiterOptions = {
  windowSeconds?: number;
  max?: number;
  skipInTest?: boolean;
};

/**
 * Rate-limits login attempts per submitted username, independent of the
 * per-IP limiter above. A per-IP-only limit can be bypassed against a single
 * targeted account by distributing attempts across many IPs; this closes
 * that gap. Backed by Redis (not in-memory) so the counter is correct even
 * across multiple app instances.
 */
export function createUsernameRateLimiter(
  redisClient: Redis,
  {
    windowSeconds = DEFAULT_WINDOW_SECONDS,
    max = DEFAULT_MAX_ATTEMPTS,
    skipInTest = true,
  }: UsernameRateLimiterOptions = {}
): RequestHandler {
  return asyncHandler(async (request, response, next) => {
    if (skipInTest && process.env.NODE_ENV === 'test') {
      next();
      return;
    }

    const username =
      typeof request.body?.username === 'string'
        ? request.body.username.trim().toLowerCase()
        : null;

    if (!username) {
      next();
      return;
    }

    const key = `login:user:${username}`;
    const attempts = await redisClient.incr(key);

    if (attempts === 1) {
      await redisClient.expire(key, windowSeconds);
    }

    if (attempts > max) {
      response.status(429).json({
        error:
          'Too many login attempts for this account. Please try again later.',
      });
      return;
    }

    next();
  });
}
