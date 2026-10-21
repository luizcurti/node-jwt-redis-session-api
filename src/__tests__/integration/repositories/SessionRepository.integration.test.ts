import {
  REFRESH_GRACE_PERIOD_MS,
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS,
  SessionRecord,
  SessionRepository,
} from '../../../repositories/SessionRepository';
import {
  closeTestConnections,
  resetCache,
  testRedisClient,
} from '../../testSetup/testDb';

describe('SessionRepository (integration)', () => {
  const repository = new SessionRepository(testRedisClient);

  function freshRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
    const now = Date.now();
    return {
      userId: 'user-1',
      role: 'user',
      refreshTokenHash: 'hash-0',
      createdAt: now,
      expiresAt: now + SESSION_IDLE_TTL_SECONDS * 1000,
      absoluteExpiresAt: now + SESSION_ABSOLUTE_TTL_SECONDS * 1000,
      ...overrides,
    };
  }

  beforeEach(async () => {
    await resetCache();
  });

  afterAll(async () => {
    await closeTestConnections();
  });

  it('returns null for a session that was never created', async () => {
    await expect(repository.get('missing-session')).resolves.toBeNull();
  });

  describe('create', () => {
    it('round-trips a session and indexes it under its user', async () => {
      const record = freshRecord();
      await repository.create('session-1', record);

      await expect(repository.get('session-1')).resolves.toEqual(record);
      await expect(
        testRedisClient.smembers('user_sessions:user-1')
      ).resolves.toEqual(['session-1']);
    });

    it('uses the idle TTL, capped by the remaining absolute lifetime', async () => {
      await repository.create('long', freshRecord());
      await repository.create(
        'short',
        freshRecord({ absoluteExpiresAt: Date.now() + 30_000 })
      );

      const longTtl = await testRedisClient.ttl('session:long');
      const shortTtl = await testRedisClient.ttl('session:short');

      expect(longTtl).toBeGreaterThan(SESSION_IDLE_TTL_SECONDS - 5);
      expect(longTtl).toBeLessThanOrEqual(SESSION_IDLE_TTL_SECONDS);
      expect(shortTtl).toBeGreaterThan(0);
      expect(shortTtl).toBeLessThanOrEqual(30);
    });
  });

  describe('rotate', () => {
    const params = (
      presentedHash: string,
      newHash: string,
      now = Date.now()
    ) => ({
      presentedHash,
      newHash,
      role: 'admin' as const,
      now,
    });

    it('swaps the hash, updates the role, keeps the previous hash and slides the idle TTL', async () => {
      const original = freshRecord();
      await repository.create('session-1', original);

      await expect(
        repository.rotate('session-1', 'user-1', params('hash-0', 'hash-1'))
      ).resolves.toBe('rotated');

      const stored = await repository.get('session-1');
      expect(stored).toMatchObject({
        refreshTokenHash: 'hash-1',
        previousRefreshTokenHash: 'hash-0',
        role: 'admin',
      });
      expect(stored?.rotatedAt).toEqual(expect.any(Number));
      // Large millisecond timestamps survive the cjson round trip intact.
      expect(stored?.absoluteExpiresAt).toBe(original.absoluteExpiresAt);
      expect(stored?.createdAt).toBe(original.createdAt);
    });

    it('never extends the session past its absolute lifetime', async () => {
      const absoluteExpiresAt = Date.now() + 20_000;
      await repository.create('session-1', freshRecord({ absoluteExpiresAt }));

      await repository.rotate(
        'session-1',
        'user-1',
        params('hash-0', 'hash-1')
      );

      const ttl = await testRedisClient.ttl('session:session-1');
      expect(ttl).toBeLessThanOrEqual(20);
      expect(
        (await repository.get('session-1'))?.expiresAt
      ).toBeLessThanOrEqual(absoluteExpiresAt + 1000);
    });

    it('refuses (and deletes) a session past its absolute lifetime', async () => {
      const now = Date.now();
      await repository.create('session-1', freshRecord());

      await expect(
        repository.rotate(
          'session-1',
          'user-1',
          params(
            'hash-0',
            'hash-1',
            now + (SESSION_ABSOLUTE_TTL_SECONDS + 1) * 1000
          )
        )
      ).resolves.toBe('missing');
      await expect(repository.get('session-1')).resolves.toBeNull();
    });

    it('returns missing for an unknown session', async () => {
      await expect(
        repository.rotate('nope', 'user-1', params('a', 'b'))
      ).resolves.toBe('missing');
    });

    it('treats the just-rotated-away token as a benign race within the grace period', async () => {
      const now = Date.now();
      await repository.create('session-1', freshRecord());
      await repository.rotate(
        'session-1',
        'user-1',
        params('hash-0', 'hash-1', now)
      );

      await expect(
        repository.rotate(
          'session-1',
          'user-1',
          params('hash-0', 'hash-x', now + REFRESH_GRACE_PERIOD_MS - 1)
        )
      ).resolves.toBe('concurrent');
      // Session untouched: the winner's token still works.
      await expect(repository.get('session-1')).resolves.toMatchObject({
        refreshTokenHash: 'hash-1',
      });
    });

    it('treats the previous token as reuse once the grace period has passed, deleting the session', async () => {
      const now = Date.now();
      await repository.create('session-1', freshRecord());
      await repository.rotate(
        'session-1',
        'user-1',
        params('hash-0', 'hash-1', now)
      );

      await expect(
        repository.rotate(
          'session-1',
          'user-1',
          params('hash-0', 'hash-x', now + REFRESH_GRACE_PERIOD_MS + 1)
        )
      ).resolves.toBe('reused');
      await expect(repository.get('session-1')).resolves.toBeNull();
      await expect(
        testRedisClient.sismember('user_sessions:user-1', 'session-1')
      ).resolves.toBe(0);
    });

    it('treats a token older than the previous one as reuse even inside the grace period', async () => {
      const now = Date.now();
      await repository.create('session-1', freshRecord());
      await repository.rotate(
        'session-1',
        'user-1',
        params('hash-0', 'hash-1', now)
      );
      await repository.rotate(
        'session-1',
        'user-1',
        params('hash-1', 'hash-2', now)
      );

      await expect(
        repository.rotate(
          'session-1',
          'user-1',
          params('hash-0', 'hash-x', now)
        )
      ).resolves.toBe('reused');
    });

    it('is atomic: of many concurrent rotations with the same valid token, exactly one wins', async () => {
      await repository.create('session-1', freshRecord());

      const outcomes = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          repository.rotate(
            'session-1',
            'user-1',
            params('hash-0', `hash-${i + 1}`)
          )
        )
      );

      expect(outcomes.filter(o => o === 'rotated')).toHaveLength(1);
      expect(outcomes.filter(o => o === 'concurrent')).toHaveLength(19);
    });
  });

  describe('delete', () => {
    it('removes the session and its index entry', async () => {
      await repository.create('session-1', freshRecord());
      await repository.delete('session-1', 'user-1');

      await expect(repository.get('session-1')).resolves.toBeNull();
      await expect(
        testRedisClient.sismember('user_sessions:user-1', 'session-1')
      ).resolves.toBe(0);
    });
  });

  describe('deleteAllForUser', () => {
    it("removes every session of that user and none of anyone else's", async () => {
      await repository.create('a1', freshRecord());
      await repository.create('a2', freshRecord());
      await repository.create('b1', freshRecord({ userId: 'user-2' }));

      await expect(repository.deleteAllForUser('user-1')).resolves.toBe(2);

      await expect(repository.get('a1')).resolves.toBeNull();
      await expect(repository.get('a2')).resolves.toBeNull();
      await expect(repository.get('b1')).resolves.not.toBeNull();
      await expect(
        testRedisClient.exists('user_sessions:user-1')
      ).resolves.toBe(0);
    });

    it('returns 0 for a user with no sessions', async () => {
      await expect(repository.deleteAllForUser('nobody')).resolves.toBe(0);
    });
  });
});
