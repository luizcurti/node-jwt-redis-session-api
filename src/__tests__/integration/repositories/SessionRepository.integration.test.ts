import { SessionRepository } from '../../../repositories/SessionRepository';
import {
  closeTestConnections,
  resetCache,
  testRedisClient,
} from '../../testSetup/testDb';

describe('SessionRepository (integration)', () => {
  const repository = new SessionRepository(testRedisClient);

  const record = {
    userId: 'user-1',
    refreshTokenHash: 'hash',
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };

  beforeEach(async () => {
    await resetCache();
  });

  afterAll(async () => {
    await closeTestConnections();
  });

  it('returns null for a session that was never created', async () => {
    await expect(repository.get('missing-session')).resolves.toBeNull();
  });

  it('round-trips a session through Redis', async () => {
    await repository.set('session-1', record);

    await expect(repository.get('session-1')).resolves.toEqual(record);
  });

  it('applies the TTL passed to set', async () => {
    await repository.set('session-1', record, 120);

    const ttl = await testRedisClient.ttl('session:session-1');

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it('resets the TTL when a session is overwritten (rotation)', async () => {
    await repository.set('session-1', record, 5);
    await repository.set(
      'session-1',
      { ...record, refreshTokenHash: 'new' },
      120
    );

    const ttl = await testRedisClient.ttl('session:session-1');
    expect(ttl).toBeGreaterThan(5);

    await expect(repository.get('session-1')).resolves.toEqual({
      ...record,
      refreshTokenHash: 'new',
    });
  });

  it('removes the session on delete', async () => {
    await repository.set('session-1', record);
    await repository.delete('session-1');

    await expect(repository.get('session-1')).resolves.toBeNull();
  });
});
