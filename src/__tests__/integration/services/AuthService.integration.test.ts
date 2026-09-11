import { UnauthorizedError, ValidationError } from '../../../errors/AppError';
import { CacheRepository } from '../../../repositories/CacheRepository';
import { SessionRepository } from '../../../repositories/SessionRepository';
import { UserRepository } from '../../../repositories/UserRepository';
import { AuthService } from '../../../services/AuthService';
import { UserService } from '../../../services/UserService';
import { TokenService } from '../../../services/TokenService';
import {
  closeTestConnections,
  resetCache,
  resetDatabase,
  testPool,
  testRedisClient,
} from '../../testSetup/testDb';

describe('AuthService (integration)', () => {
  const userRepository = new UserRepository(testPool);
  const cacheRepository = new CacheRepository(testRedisClient);
  const sessionRepository = new SessionRepository(testRedisClient);
  const tokenService = new TokenService();
  const userService = new UserService(userRepository, cacheRepository);
  const authService = new AuthService(
    userRepository,
    cacheRepository,
    sessionRepository,
    tokenService
  );

  beforeEach(async () => {
    await resetDatabase();
    await resetCache();
    await userService.createUser({
      username: 'integrationuser',
      name: 'Test User',
      password: 'password123456',
      email: 'integration@example.com',
    });
  });

  afterAll(async () => {
    await closeTestConnections();
  });

  it('throws ValidationError when credentials are missing', async () => {
    await expect(
      authService.login({ username: 'integrationuser' })
    ).rejects.toThrow(ValidationError);
  });

  it('throws UnauthorizedError for a wrong password', async () => {
    await expect(
      authService.login({ username: 'integrationuser', password: 'wrong' })
    ).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError for an unknown username', async () => {
    await expect(
      authService.login({ username: 'ghost', password: 'password123456' })
    ).rejects.toThrow(UnauthorizedError);
  });

  it('logs in, returns a verifiable access token, creates a session, and caches the profile', async () => {
    const result = await authService.login({
      username: 'integrationuser',
      password: 'password123456',
    });

    const { subject, sessionId } = tokenService.verifyAccessToken(
      result.accessToken
    );
    expect(subject).toEqual(result.user.id);

    const session = await sessionRepository.get(sessionId);
    expect(session).not.toBeNull();
    expect(session?.userId).toEqual(result.user.id);

    const cached = await cacheRepository.getUserProfile(result.user.id);
    expect(cached).toEqual(result.user);
  });

  describe('refresh', () => {
    it('rotates the refresh token and rejects the old one on reuse', async () => {
      const { refreshToken } = await authService.login({
        username: 'integrationuser',
        password: 'password123456',
      });

      const rotated = await authService.refresh(refreshToken);
      expect(rotated.refreshToken).not.toEqual(refreshToken);

      await expect(authService.refresh(refreshToken)).rejects.toThrow(
        UnauthorizedError
      );
    });

    it('kills the session entirely once a used refresh token is replayed', async () => {
      const { refreshToken } = await authService.login({
        username: 'integrationuser',
        password: 'password123456',
      });
      const rotated = await authService.refresh(refreshToken);

      await expect(authService.refresh(refreshToken)).rejects.toThrow(
        UnauthorizedError
      );

      await expect(authService.refresh(rotated.refreshToken)).rejects.toThrow(
        UnauthorizedError
      );
    });

    it('throws UnauthorizedError for an unknown or expired session', async () => {
      await expect(
        authService.refresh('unknown-session.some-validator')
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('logout', () => {
    it('deletes the session so refresh is no longer possible', async () => {
      const { accessToken, refreshToken } = await authService.login({
        username: 'integrationuser',
        password: 'password123456',
      });
      const { sessionId } = tokenService.verifyAccessToken(accessToken);

      await authService.logout(sessionId);

      await expect(sessionRepository.get(sessionId)).resolves.toBeNull();
      await expect(authService.refresh(refreshToken)).rejects.toThrow(
        UnauthorizedError
      );
    });
  });
});
