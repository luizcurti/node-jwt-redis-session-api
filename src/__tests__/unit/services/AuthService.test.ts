import {
  ConflictError,
  TooManyRequestsError,
  UnauthorizedError,
  ValidationError,
} from '../../../errors/AppError';
import { logger } from '../../../logger';
import { CacheRepository } from '../../../repositories/CacheRepository';
import {
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS,
  SessionRepository,
} from '../../../repositories/SessionRepository';
import { UserRepository } from '../../../repositories/UserRepository';
import { AuthService } from '../../../services/AuthService';
import { LoginThrottle } from '../../../services/LoginThrottle';
import { TokenService } from '../../../services/TokenService';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

import { compare } from 'bcryptjs';

describe('AuthService', () => {
  let userRepository: jest.Mocked<
    Pick<UserRepository, 'findByUsername' | 'findById'>
  >;
  let cacheRepository: jest.Mocked<Pick<CacheRepository, 'setUserProfile'>>;
  let sessionRepository: jest.Mocked<
    Pick<
      SessionRepository,
      'get' | 'create' | 'rotate' | 'delete' | 'deleteAllForUser'
    >
  >;
  let tokenService: jest.Mocked<
    Pick<
      TokenService,
      | 'signAccessToken'
      | 'generateRefreshToken'
      | 'splitRefreshToken'
      | 'hashRefreshValidator'
    >
  >;
  let loginThrottle: jest.Mocked<
    Pick<LoginThrottle, 'assertNotThrottled' | 'recordFailure' | 'reset'>
  >;
  let service: AuthService;

  const storedUser = {
    id: 'user-1',
    name: 'Test User',
    username: 'testuser',
    passwordHash: 'hashed-password',
    email: 'test@example.com',
    role: 'user' as const,
  };

  const storedSession = {
    userId: 'user-1',
    role: 'user' as const,
    refreshTokenHash: 'stored-hash',
    createdAt: 1000,
    expiresAt: 2000,
    absoluteExpiresAt: 3000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userRepository = { findByUsername: jest.fn(), findById: jest.fn() };
    cacheRepository = { setUserProfile: jest.fn() };
    sessionRepository = {
      get: jest.fn(),
      create: jest.fn(),
      rotate: jest.fn(),
      delete: jest.fn(),
      deleteAllForUser: jest.fn(),
    };
    tokenService = {
      signAccessToken: jest.fn().mockReturnValue('signed-access-token'),
      generateRefreshToken: jest
        .fn()
        .mockReturnValue({ validator: 'new-validator', hash: 'new-hash' }),
      splitRefreshToken: jest.fn(),
      hashRefreshValidator: jest.fn().mockReturnValue('presented-hash'),
    };
    loginThrottle = {
      assertNotThrottled: jest.fn(),
      recordFailure: jest.fn(),
      reset: jest.fn(),
    };
    service = new AuthService(
      userRepository as unknown as UserRepository,
      cacheRepository as unknown as CacheRepository,
      sessionRepository as unknown as SessionRepository,
      tokenService as unknown as TokenService,
      loginThrottle as unknown as LoginThrottle
    );
  });

  describe('login', () => {
    it('throws ValidationError when username or password is missing', async () => {
      await expect(service.login({ username: 'testuser' })).rejects.toThrow(
        ValidationError
      );
    });

    it('throws ValidationError when username or password is empty', async () => {
      await expect(
        service.login({ username: '', password: 'password123456' })
      ).rejects.toThrow('Username and password are required.');
    });

    it('trims whitespace from the username before looking it up', async () => {
      userRepository.findByUsername.mockResolvedValueOnce(storedUser);
      (compare as jest.Mock).mockResolvedValueOnce(true);

      await service.login({
        username: '  testuser  ',
        password: 'password123456',
      });

      expect(userRepository.findByUsername).toHaveBeenCalledWith('testuser');
    });

    it('rejects a throttled account before touching the database or bcrypt', async () => {
      loginThrottle.assertNotThrottled.mockRejectedValueOnce(
        new TooManyRequestsError('slow down', 4)
      );

      await expect(
        service.login({ username: 'testuser', password: 'password123456' })
      ).rejects.toThrow(TooManyRequestsError);
      expect(userRepository.findByUsername).not.toHaveBeenCalled();
      expect(compare).not.toHaveBeenCalled();
    });

    it('still runs bcrypt against a dummy hash when the user does not exist (no timing oracle)', async () => {
      userRepository.findByUsername.mockResolvedValueOnce(null);
      (compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.login({ username: 'missing', password: 'password123456' })
      ).rejects.toThrow(UnauthorizedError);
      expect(compare).toHaveBeenCalledWith(
        'password123456',
        expect.stringMatching(/^\$2[aby]\$12\$/)
      );
      expect(loginThrottle.recordFailure).toHaveBeenCalledWith('missing');
    });

    it('records a failure and throws UnauthorizedError when the password does not match', async () => {
      userRepository.findByUsername.mockResolvedValueOnce(storedUser);
      (compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.login({ username: 'testuser', password: 'wrongpassword' })
      ).rejects.toThrow(UnauthorizedError);
      expect(compare).toHaveBeenCalledWith('wrongpassword', 'hashed-password');
      expect(loginThrottle.recordFailure).toHaveBeenCalledWith('testuser');
      expect(sessionRepository.create).not.toHaveBeenCalled();
    });

    it('creates a session with idle and absolute expiry, caches the profile, and returns both tokens', async () => {
      userRepository.findByUsername.mockResolvedValueOnce(storedUser);
      (compare as jest.Mock).mockResolvedValueOnce(true);
      const before = Date.now();

      const result = await service.login({
        username: 'testuser',
        password: 'password123456',
      });

      expect(loginThrottle.reset).toHaveBeenCalledWith('testuser');
      expect(result.accessToken).toBe('signed-access-token');
      expect(result.refreshToken).toMatch(/^.+\.new-validator$/);
      expect(result.user).toEqual({
        id: 'user-1',
        name: 'Test User',
        username: 'testuser',
        email: 'test@example.com',
        role: 'user',
      });

      const [, record] = sessionRepository.create.mock.calls[0];
      expect(record).toMatchObject({
        userId: 'user-1',
        role: 'user',
        refreshTokenHash: 'new-hash',
      });
      expect(record.expiresAt - record.createdAt).toBe(
        SESSION_IDLE_TTL_SECONDS * 1000
      );
      expect(record.absoluteExpiresAt - record.createdAt).toBe(
        SESSION_ABSOLUTE_TTL_SECONDS * 1000
      );
      expect(record.createdAt).toBeGreaterThanOrEqual(before);
      expect(cacheRepository.setUserProfile).toHaveBeenCalledWith(
        'user-1',
        result.user
      );
    });

    it('still succeeds when caching the profile fails (cache is best-effort)', async () => {
      userRepository.findByUsername.mockResolvedValueOnce(storedUser);
      (compare as jest.Mock).mockResolvedValueOnce(true);
      cacheRepository.setUserProfile.mockRejectedValueOnce(
        new Error('redis unreachable')
      );
      const loggerErrorSpy = jest
        .spyOn(logger, 'error')
        .mockImplementation(() => logger);

      const result = await service.login({
        username: 'testuser',
        password: 'password123456',
      });

      expect(result.accessToken).toBe('signed-access-token');
      expect(loggerErrorSpy).toHaveBeenCalled();

      loggerErrorSpy.mockRestore();
    });
  });

  describe('refresh', () => {
    function withValidSplit(): void {
      tokenService.splitRefreshToken.mockReturnValueOnce({
        sessionId: 'session-1',
        validator: 'presented-validator',
      });
    }

    it('throws ValidationError when no token is provided', async () => {
      await expect(service.refresh(undefined)).rejects.toThrow(ValidationError);
    });

    it('throws UnauthorizedError for a malformed token', async () => {
      tokenService.splitRefreshToken.mockReturnValueOnce(null);

      await expect(service.refresh('not-well-formed')).rejects.toThrow(
        UnauthorizedError
      );
    });

    it('throws UnauthorizedError when the session does not exist', async () => {
      withValidSplit();
      sessionRepository.get.mockResolvedValueOnce(null);

      await expect(service.refresh('session-1.x')).rejects.toThrow(
        UnauthorizedError
      );
      expect(userRepository.findById).not.toHaveBeenCalled();
    });

    it('revokes every session of a user that no longer exists in PostgreSQL', async () => {
      withValidSplit();
      sessionRepository.get.mockResolvedValueOnce(storedSession);
      userRepository.findById.mockResolvedValueOnce(null);

      await expect(service.refresh('session-1.x')).rejects.toThrow(
        UnauthorizedError
      );
      expect(sessionRepository.deleteAllForUser).toHaveBeenCalledWith('user-1');
      expect(sessionRepository.rotate).not.toHaveBeenCalled();
    });

    it('rotates atomically and mints the access token with the role freshly read from PostgreSQL', async () => {
      withValidSplit();
      sessionRepository.get.mockResolvedValueOnce(storedSession);
      userRepository.findById.mockResolvedValueOnce({
        ...storedUser,
        role: 'admin',
      });
      sessionRepository.rotate.mockResolvedValueOnce('rotated');

      const result = await service.refresh('session-1.presented-validator');

      expect(tokenService.hashRefreshValidator).toHaveBeenCalledWith(
        'presented-validator'
      );
      expect(sessionRepository.rotate).toHaveBeenCalledWith(
        'session-1',
        'user-1',
        expect.objectContaining({
          presentedHash: 'presented-hash',
          newHash: 'new-hash',
          role: 'admin',
        })
      );
      expect(tokenService.signAccessToken).toHaveBeenCalledWith(
        'user-1',
        'session-1',
        'admin'
      );
      expect(result).toEqual({
        accessToken: 'signed-access-token',
        refreshToken: 'session-1.new-validator',
      });
    });

    it('rejects a benign concurrent refresh with ConflictError without killing the session', async () => {
      withValidSplit();
      sessionRepository.get.mockResolvedValueOnce(storedSession);
      userRepository.findById.mockResolvedValueOnce(storedUser);
      sessionRepository.rotate.mockResolvedValueOnce('concurrent');

      await expect(service.refresh('session-1.x')).rejects.toThrow(
        ConflictError
      );
      expect(sessionRepository.delete).not.toHaveBeenCalled();
    });

    it('logs and rejects a reused token (the repository has already deleted the session)', async () => {
      withValidSplit();
      sessionRepository.get.mockResolvedValueOnce(storedSession);
      userRepository.findById.mockResolvedValueOnce(storedUser);
      sessionRepository.rotate.mockResolvedValueOnce('reused');
      const warnSpy = jest
        .spyOn(logger, 'warn')
        .mockImplementation(() => logger);

      await expect(service.refresh('session-1.x')).rejects.toThrow(
        'Invalid refresh token.'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        { sessionId: 'session-1', userId: 'user-1' },
        'Refresh token reuse detected, session revoked'
      );

      warnSpy.mockRestore();
    });

    it('rejects when the session vanished or hit its absolute lifetime mid-refresh', async () => {
      withValidSplit();
      sessionRepository.get.mockResolvedValueOnce(storedSession);
      userRepository.findById.mockResolvedValueOnce(storedUser);
      sessionRepository.rotate.mockResolvedValueOnce('missing');

      await expect(service.refresh('session-1.x')).rejects.toThrow(
        UnauthorizedError
      );
    });
  });

  describe('logout', () => {
    it('throws UnauthorizedError when no sessionId is provided', async () => {
      await expect(service.logout(undefined, 'user-1')).rejects.toThrow(
        UnauthorizedError
      );
    });

    it('throws UnauthorizedError when no userId is provided', async () => {
      await expect(service.logout('session-1', undefined)).rejects.toThrow(
        UnauthorizedError
      );
    });

    it('deletes the session', async () => {
      await service.logout('session-1', 'user-1');

      expect(sessionRepository.delete).toHaveBeenCalledWith(
        'session-1',
        'user-1'
      );
    });
  });

  describe('logoutAll', () => {
    it('throws UnauthorizedError when no userId is provided', async () => {
      await expect(service.logoutAll(undefined)).rejects.toThrow(
        UnauthorizedError
      );
    });

    it('revokes every session of the user and returns how many', async () => {
      sessionRepository.deleteAllForUser.mockResolvedValueOnce(3);

      await expect(service.logoutAll('user-1')).resolves.toBe(3);
      expect(sessionRepository.deleteAllForUser).toHaveBeenCalledWith('user-1');
    });
  });
});
