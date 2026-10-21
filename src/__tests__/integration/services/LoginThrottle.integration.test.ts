import { TooManyRequestsError } from '../../../errors/AppError';
import { LoginThrottle } from '../../../services/LoginThrottle';
import {
  closeTestConnections,
  resetCache,
  testRedisClient,
} from '../../testSetup/testDb';

describe('LoginThrottle (integration, real Redis)', () => {
  const throttle = new LoginThrottle(testRedisClient, {
    freeAttempts: 3,
    baseDelaySeconds: 2,
    maxDelaySeconds: 10,
    failureWindowSeconds: 600,
  });

  async function fail(times: number, username = 'alice'): Promise<void> {
    for (let i = 0; i < times; i++) {
      await throttle.recordFailure(username);
    }
  }

  beforeEach(async () => {
    await resetCache();
  });

  afterAll(async () => {
    await closeTestConnections();
  });

  it('lets the free attempts through without any delay', async () => {
    await fail(3);

    await expect(throttle.assertNotThrottled('alice')).resolves.toBeUndefined();
  });

  it('sets the failure-window TTL on the first failure only, atomically', async () => {
    await fail(1);
    const firstTtl = await testRedisClient.ttl('login:failures:alice');
    await fail(1);
    const secondTtl = await testRedisClient.ttl('login:failures:alice');

    expect(firstTtl).toBeGreaterThan(590);
    expect(secondTtl).toBeLessThanOrEqual(firstTtl);
  });

  it('grows the delay exponentially past the free attempts, capped at the max', async () => {
    const lockTtls: number[] = [];
    for (let i = 0; i < 6; i++) {
      await fail(1);
      lockTtls.push(await testRedisClient.ttl('login:lock:alice'));
    }

    // 3 free (no lock: -2), then 2s, 4s, 8s, then capped at 10s.
    expect(lockTtls).toEqual([-2, -2, -2, 2, 4, 8]);
    await fail(1);
    expect(await testRedisClient.ttl('login:lock:alice')).toBe(10);

    await expect(throttle.assertNotThrottled('alice')).rejects.toBeInstanceOf(
      TooManyRequestsError
    );
  });

  it('is keyed by the normalized username, independent per account', async () => {
    await fail(4, '  Alice ');

    await expect(throttle.assertNotThrottled('alice')).rejects.toThrow(
      TooManyRequestsError
    );
    await expect(throttle.assertNotThrottled('bob')).resolves.toBeUndefined();
  });

  it('reset clears the counter and the lock', async () => {
    await fail(5);
    await throttle.reset('alice');

    await expect(throttle.assertNotThrottled('alice')).resolves.toBeUndefined();
    await expect(testRedisClient.exists('login:failures:alice')).resolves.toBe(
      0
    );
  });
});
