import { Redis } from 'ioredis';
import { TooManyRequestsError } from '../../../errors/AppError';
import { LoginThrottle } from '../../../services/LoginThrottle';

// The backoff arithmetic runs in Lua inside Redis — covered against a real
// instance in LoginThrottle.integration.test.ts.
describe('LoginThrottle', () => {
  let redisClient: { ttl: jest.Mock; eval: jest.Mock; del: jest.Mock };
  let throttle: LoginThrottle;

  beforeEach(() => {
    redisClient = { ttl: jest.fn(), eval: jest.fn(), del: jest.fn() };
    throttle = new LoginThrottle(redisClient as unknown as Redis, {
      freeAttempts: 3,
      baseDelaySeconds: 2,
      maxDelaySeconds: 60,
      failureWindowSeconds: 300,
    });
  });

  describe('assertNotThrottled', () => {
    it('passes when there is no lock (-2) for the normalized username', async () => {
      redisClient.ttl.mockResolvedValueOnce(-2);

      await expect(
        throttle.assertNotThrottled('  Alice ')
      ).resolves.toBeUndefined();
      expect(redisClient.ttl).toHaveBeenCalledWith('login:lock:alice');
    });

    it('throws TooManyRequestsError carrying the remaining lock time', async () => {
      redisClient.ttl.mockResolvedValueOnce(7);

      const error = await throttle
        .assertNotThrottled('alice')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TooManyRequestsError);
      expect(error).toHaveProperty('retryAfterSeconds', 7);
      expect(error).toHaveProperty('statusCode', 429);
    });
  });

  it('recordFailure runs the atomic script with the configured policy', async () => {
    await throttle.recordFailure('Alice');

    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR', KEYS[1])"),
      2,
      'login:failures:alice',
      'login:lock:alice',
      300,
      3,
      2,
      60
    );
  });

  it('reset clears both the failure counter and any lock', async () => {
    await throttle.reset('ALICE');

    expect(redisClient.del).toHaveBeenCalledWith(
      'login:failures:alice',
      'login:lock:alice'
    );
  });

  it('uses sensible defaults when no options are given', async () => {
    const defaults = new LoginThrottle(redisClient as unknown as Redis);

    await defaults.recordFailure('bob');

    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'login:failures:bob',
      'login:lock:bob',
      900,
      5,
      1,
      900
    );
  });
});
