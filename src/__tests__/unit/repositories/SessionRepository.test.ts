import { Redis } from 'ioredis';
import {
  DEFAULT_TTL_SECONDS,
  SessionRepository,
} from '../../../repositories/SessionRepository';

describe('SessionRepository', () => {
  let redisClient: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let repository: SessionRepository;

  const record = {
    userId: 'user-1',
    role: 'user' as const,
    refreshTokenHash: 'hash',
    createdAt: 1000,
    expiresAt: 2000,
  };

  beforeEach(() => {
    redisClient = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
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

      const result = await repository.get('session-1');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('stores the session with the default TTL', async () => {
      await repository.set('session-1', record);

      expect(redisClient.set).toHaveBeenCalledWith(
        'session:session-1',
        JSON.stringify(record),
        'EX',
        DEFAULT_TTL_SECONDS
      );
    });

    it('stores the session with a custom TTL', async () => {
      await repository.set('session-1', record, 60);

      expect(redisClient.set).toHaveBeenCalledWith(
        'session:session-1',
        JSON.stringify(record),
        'EX',
        60
      );
    });
  });

  describe('delete', () => {
    it('removes the session key', async () => {
      await repository.delete('session-1');

      expect(redisClient.del).toHaveBeenCalledWith('session:session-1');
    });
  });
});
