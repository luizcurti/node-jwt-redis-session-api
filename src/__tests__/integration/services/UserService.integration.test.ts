import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../errors/AppError';
import { CacheRepository } from '../../../repositories/CacheRepository';
import { UserRepository } from '../../../repositories/UserRepository';
import { UserService } from '../../../services/UserService';
import {
  closeTestConnections,
  resetCache,
  resetDatabase,
  testPool,
  testRedisClient,
} from '../../testSetup/testDb';

describe('UserService (integration)', () => {
  const userRepository = new UserRepository(testPool);
  const cacheRepository = new CacheRepository(testRedisClient);
  const service = new UserService(userRepository, cacheRepository);

  beforeEach(async () => {
    await resetDatabase();
    await resetCache();
  });

  afterAll(async () => {
    await closeTestConnections();
  });

  it('creates a user that is then findable in Postgres', async () => {
    const { id } = await service.createUser({
      username: 'integrationuser',
      name: 'Test User',
      password: 'password123456',
      email: 'integration@example.com',
    });

    const stored = await userRepository.findByUsername('integrationuser');

    expect(stored?.id).toBe(id);
    expect(stored?.password).not.toBe('password123456');
  });

  it('rejects creating a user with a username that already exists', async () => {
    const input = {
      username: 'integrationuser',
      name: 'Test User',
      password: 'password123456',
      email: 'integration@example.com',
    };

    await service.createUser(input);

    await expect(
      service.createUser({ ...input, email: 'other@example.com' })
    ).rejects.toThrow(ConflictError);
  });

  const NON_EXISTENT_ID = '00000000-0000-0000-0000-000000000000';

  it('throws ForbiddenError when fetching another user profile', async () => {
    await expect(
      service.getUserProfile(NON_EXISTENT_ID, 'a-different-id')
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws NotFoundError when the user exists in neither cache nor PostgreSQL', async () => {
    await expect(
      service.getUserProfile(NON_EXISTENT_ID, NON_EXISTENT_ID)
    ).rejects.toThrow(NotFoundError);
  });

  it('returns the cached profile for the owning user without touching PostgreSQL', async () => {
    const profile = {
      id: NON_EXISTENT_ID,
      name: 'Test User',
      username: 'integrationuser',
      email: 'integration@example.com',
    };
    await cacheRepository.setUserProfile(NON_EXISTENT_ID, profile);

    await expect(
      service.getUserProfile(NON_EXISTENT_ID, NON_EXISTENT_ID)
    ).resolves.toEqual(profile);
  });

  it('falls back to PostgreSQL and repopulates the cache on a cache miss', async () => {
    const { id } = await service.createUser({
      username: 'readthroughuser',
      name: 'Read Through User',
      password: 'password123456',
      email: 'readthrough@example.com',
    });

    const profile = await service.getUserProfile(id, id);

    expect(profile).toMatchObject({
      id,
      username: 'readthroughuser',
      email: 'readthrough@example.com',
    });
    await expect(cacheRepository.getUserProfile(id)).resolves.toEqual(profile);
  });
});
