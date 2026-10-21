import {
  ConflictError,
  TooManyRequestsError,
  UnauthorizedError,
  ValidationError,
} from '../../../errors/AppError';
import { CacheRepository } from '../../../repositories/CacheRepository';
import {
  REFRESH_GRACE_PERIOD_MS,
  SessionRepository,
} from '../../../repositories/SessionRepository';
import { UserRepository } from '../../../repositories/UserRepository';
import { AuthService } from '../../../services/AuthService';
import { LoginThrottle } from '../../../services/LoginThrottle';
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
    tokenService,
    new LoginThrottle(testRedisClient, { freeAttempts: 2 })
  );
  const credentials = {
    username: 'integrationuser',
    password: 'password123456',
  };

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

  it('carries the real role from PostgreSQL into the access token and session', async () => {
    // No self-service path promotes a user to admin — this simulates the
    // manual bootstrap step (see docs/api.md) directly against the database.
    await testPool.query(
      "UPDATE users SET role = 'admin' WHERE username = $1",
      ['integrationuser']
    );

    const result = await authService.login({
      username: 'integrationuser',
      password: 'password123456',
    });

    expect(result.user.role).toBe('admin');

    const { role, sessionId } = tokenService.verifyAccessToken(
      result.accessToken
    );
    expect(role).toBe('admin');

    const session = await sessionRepository.get(sessionId);
    expect(session?.role).toBe('admin');
  });

  describe('refresh', () => {
    // Pushes the session's last rotation back past the grace period, as if
    // the old token were replayed long after the legitimate rotation.
    async function ageLastRotation(refreshToken: string): Promise<void> {
      const sessionId = refreshToken.split('.')[0];
      const session = await sessionRepository.get(sessionId);
      await testRedisClient.set(
        `session:${sessionId}`,
        JSON.stringify({
          ...session,
          rotatedAt: Date.now() - REFRESH_GRACE_PERIOD_MS - 1,
        }),
        'KEEPTTL'
      );
    }

    it('rotates the refresh token; replaying the old one right away is a benign race (409), not theft', async () => {
      const { refreshToken } = await authService.login(credentials);

      const rotated = await authService.refresh(refreshToken);
      expect(rotated.refreshToken).not.toEqual(refreshToken);

      await expect(authService.refresh(refreshToken)).rejects.toThrow(
        ConflictError
      );
      await expect(
        authService.refresh(rotated.refreshToken)
      ).resolves.toHaveProperty('accessToken');
    });

    it('kills the session entirely once a used refresh token is replayed after the grace period', async () => {
      const { refreshToken } = await authService.login(credentials);
      const rotated = await authService.refresh(refreshToken);
      await ageLastRotation(rotated.refreshToken);

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

    it('picks up a role change from PostgreSQL on the next refresh', async () => {
      const { refreshToken } = await authService.login(credentials);

      await testPool.query(
        "UPDATE users SET role = 'admin' WHERE username = $1",
        ['integrationuser']
      );

      const rotated = await authService.refresh(refreshToken);
      const { role, sessionId } = tokenService.verifyAccessToken(
        rotated.accessToken
      );

      expect(role).toBe('admin');
      await expect(sessionRepository.get(sessionId)).resolves.toMatchObject({
        role: 'admin',
      });
    });

    it('revokes every session of a user deleted from PostgreSQL', async () => {
      const first = await authService.login(credentials);
      const second = await authService.login(credentials);
      const { subject } = tokenService.verifyAccessToken(first.accessToken);
      await testPool.query('DELETE FROM users WHERE id = $1', [subject]);

      await expect(authService.refresh(first.refreshToken)).rejects.toThrow(
        UnauthorizedError
      );
      const { sessionId } = tokenService.verifyAccessToken(second.accessToken);
      await expect(sessionRepository.get(sessionId)).resolves.toBeNull();
    });

    it('refuses to refresh past the absolute session lifetime', async () => {
      const { accessToken, refreshToken } =
        await authService.login(credentials);
      const { sessionId } = tokenService.verifyAccessToken(accessToken);
      const session = await sessionRepository.get(sessionId);
      await testRedisClient.set(
        `session:${sessionId}`,
        JSON.stringify({ ...session, absoluteExpiresAt: Date.now() - 1 })
      );

      await expect(authService.refresh(refreshToken)).rejects.toThrow(
        UnauthorizedError
      );
      await expect(sessionRepository.get(sessionId)).resolves.toBeNull();
    });

    it('lets exactly one of two simultaneous refreshes win; the loser gets a ConflictError and the session survives', async () => {
      const { refreshToken } = await authService.login(credentials);

      const results = await Promise.allSettled([
        authService.refresh(refreshToken),
        authService.refresh(refreshToken),
      ]);
      const winner = results.find(r => r.status === 'fulfilled') as
        PromiseFulfilledResult<{ refreshToken: string }> | undefined;
      const loser = results.find(r => r.status === 'rejected') as
        PromiseRejectedResult | undefined;

      expect(winner).toBeDefined();
      expect(loser?.reason).toBeInstanceOf(ConflictError);
      await expect(
        authService.refresh(winner!.value.refreshToken)
      ).resolves.toHaveProperty('accessToken');
    });
  });

  describe('login throttling', () => {
    it('throttles an account after its free failed attempts, and a success resets it', async () => {
      const wrong = { ...credentials, password: 'wrong-password' };
      await expect(authService.login(wrong)).rejects.toThrow(UnauthorizedError);
      await expect(authService.login(wrong)).rejects.toThrow(UnauthorizedError);
      // Third failure exceeds freeAttempts (2) and arms a 1s delay.
      await expect(authService.login(wrong)).rejects.toThrow(UnauthorizedError);

      await expect(authService.login(credentials)).rejects.toThrow(
        TooManyRequestsError
      );

      await testRedisClient.del('login:lock:integrationuser');
      await expect(authService.login(credentials)).resolves.toHaveProperty(
        'accessToken'
      );
      await expect(
        testRedisClient.exists('login:failures:integrationuser')
      ).resolves.toBe(0);
    });

    it('counts failures for unknown usernames too, without revealing that they are unknown', async () => {
      const ghost = { username: 'ghost', password: 'password123456' };
      await expect(authService.login(ghost)).rejects.toThrow(
        'Invalid credentials.'
      );

      await expect(testRedisClient.get('login:failures:ghost')).resolves.toBe(
        '1'
      );
    });
  });

  describe('logoutAll', () => {
    it('revokes every session of the user', async () => {
      const first = await authService.login(credentials);
      const second = await authService.login(credentials);
      const { subject } = tokenService.verifyAccessToken(first.accessToken);

      await expect(authService.logoutAll(subject)).resolves.toBe(2);

      await expect(authService.refresh(first.refreshToken)).rejects.toThrow(
        UnauthorizedError
      );
      await expect(authService.refresh(second.refreshToken)).rejects.toThrow(
        UnauthorizedError
      );
    });
  });

  describe('logout', () => {
    it('deletes the session so refresh is no longer possible', async () => {
      const { accessToken, refreshToken } = await authService.login({
        username: 'integrationuser',
        password: 'password123456',
      });
      const { sessionId, subject } =
        tokenService.verifyAccessToken(accessToken);

      await authService.logout(sessionId, subject);

      await expect(sessionRepository.get(sessionId)).resolves.toBeNull();
      await expect(authService.refresh(refreshToken)).rejects.toThrow(
        UnauthorizedError
      );
    });
  });
});
