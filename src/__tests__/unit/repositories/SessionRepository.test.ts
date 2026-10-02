import { Redis } from 'ioredis';
import {
  REFRESH_GRACE_PERIOD_MS,
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS,
  SessionRepository,
} from '../../../repositories/SessionRepository';

// The Lua scripts themselves (CAS rotation, bulk revoke) run inside Redis
// and are exercised against a real instance in
// SessionRepository.integration.test.ts; this suite checks the wiring.
describe('SessionRepository', () => {
  let transaction: {
    set: jest.Mock;
    sadd: jest.Mock;
    expire: jest.Mock;
    del: jest.Mock;
    srem: jest.Mock;
    exec: jest.Mock;
  };
  let redisClient: { get: jest.Mock; multi: jest.Mock; eval: jest.Mock };
  let repository: SessionRepository;

  const now = Date.now();
  const record = {
    userId: 'user-1',
    role: 'user' as const,
    refreshTokenHash: 'hash',
    createdAt: now,
    expiresAt: now + SESSION_IDLE_TTL_SECONDS * 1000,
    absoluteExpiresAt: now + SESSION_ABSOLUTE_TTL_SECONDS * 1000,
  };

  beforeEach(() => {
    transaction = {
      set: jest.fn().mockReturnThis(),
      sadd: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      srem: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    redisClient = {
      get: jest.fn(),
      multi: jest.fn().mockReturnValue(transaction),
      eval: jest.fn(),
    };
    repository = new SessionRepository(redisClient as unknown as Redis);
  });

  describe('get', () => {
    it('returns the parsed session when found', async () => {
      redisClient.get.mockResolvedValueOnce(JSON.stringify(record));

      const result = await repository.get('session-1');

      expect(redisClient.get).toHaveBeenCalledWith('session:session-1');
      expect(result).toEqual(record);
    });

    it('returns null when the session does not exist', async () => {
      redisClient.get.mockResolvedValueOnce(null);

      await expect(repository.get('session-1')).resolves.toBeNull();
    });
  });

  describe('create', () => {
    it('stores the session with the idle TTL and indexes it under the user, in one transaction', async () => {
      await repository.create('session-1', record);

      expect(transaction.set).toHaveBeenCalledWith(
        'session:session-1',
        JSON.stringify(record),
        'EX',
        SESSION_IDLE_TTL_SECONDS
      );
      expect(transaction.sadd).toHaveBeenCalledWith(
        'user_sessions:user-1',
        'session-1'
      );
      expect(transaction.expire).toHaveBeenCalledWith(
        'user_sessions:user-1',
        SESSION_ABSOLUTE_TTL_SECONDS
      );
      expect(transaction.exec).toHaveBeenCalled();
    });

    it('caps the TTL at the remaining absolute lifetime', async () => {
      await repository.create('session-1', {
        ...record,
        absoluteExpiresAt: Date.now() + 60_000,
      });

      const ttl = transaction.set.mock.calls[0][3];
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it('throws when a queued command failed inside the transaction', async () => {
      const oom = new Error('OOM command not allowed');
      transaction.exec.mockResolvedValueOnce([
        [oom, null],
        [null, 1],
      ]);

      await expect(repository.create('session-1', record)).rejects.toBe(oom);
    });

    it('treats a null exec result as success', async () => {
      transaction.exec.mockResolvedValueOnce(null);

      await expect(
        repository.create('session-1', record)
      ).resolves.toBeUndefined();
    });
  });

  describe('rotate', () => {
    it('runs the CAS script against the session and user-index keys', async () => {
      redisClient.eval.mockResolvedValueOnce('rotated');

      const outcome = await repository.rotate('session-1', 'user-1', {
        presentedHash: 'old',
        newHash: 'new',
        role: 'admin',
        now: 42,
      });

      expect(outcome).toBe('rotated');
      expect(redisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('GET', KEYS[1])"),
        2,
        'session:session-1',
        'user_sessions:user-1',
        'old',
        'new',
        'admin',
        42,
        REFRESH_GRACE_PERIOD_MS,
        SESSION_IDLE_TTL_SECONDS,
        'session-1'
      );
    });
  });

  describe('delete', () => {
    it('removes the session key and its index entry', async () => {
      await repository.delete('session-1', 'user-1');

      expect(transaction.del).toHaveBeenCalledWith('session:session-1');
      expect(transaction.srem).toHaveBeenCalledWith(
        'user_sessions:user-1',
        'session-1'
      );
    });
  });

  describe('deleteAllForUser', () => {
    it('runs the bulk-revoke script and returns the number of sessions', async () => {
      redisClient.eval.mockResolvedValueOnce(2);

      await expect(repository.deleteAllForUser('user-1')).resolves.toBe(2);
      expect(redisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('SMEMBERS'),
        1,
        'user_sessions:user-1',
        'session:'
      );
    });
  });
});
