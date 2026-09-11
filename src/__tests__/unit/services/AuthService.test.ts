import { UnauthorizedError, ValidationError } from '../../../errors/AppError';
import { logger } from '../../../logger';
import { CacheRepository } from '../../../repositories/CacheRepository';
import { SessionRepository } from '../../../repositories/SessionRepository';
import { UserRepository } from '../../../repositories/UserRepository';
import { AuthService } from '../../../services/AuthService';
import { TokenService } from '../../../services/TokenService';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

import { compare } from 'bcryptjs';

describe('AuthService', () => {
  let userRepository: jest.Mocked<Pick<UserRepository, 'findByUsername'>>;
  let cacheRepository: jest.Mocked<Pick<CacheRepository, 'setUserProfile'>>;
  let sessionRepository: jest.Mocked<
    Pick<SessionRepository, 'get' | 'set' | 'delete'>
  >;
  let tokenService: jest.Mocked<
    Pick<
      TokenService,
      | 'signAccessToken'
      | 'generateRefreshToken'
      | 'splitRefreshToken'
      | 'validatorMatchesHash'
    >
  >;
  let service: AuthService;

  const storedUser = {
    id: 'user-1',
    name: 'Test User',
    username: 'testuser',
    password: 'hashed-password',
    email: 'test@example.com',
    role: 'user' as const,
  };

  const storedSession = {
    userId: 'user-1',
    role: 'user' as const,
    refreshTokenHash: 'stored-hash',
    createdAt: 1000,
    expiresAt: 2000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userRepository = { findByUsername: jest.fn() };
    cacheRepository = { setUserProfile: jest.fn() };
    sessionRepository = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
    tokenService = {
      signAccessToken: jest.fn().mockReturnValue('signed-access-token'),
      generateRefreshToken: jest
        .fn()
        .mockReturnValue({ validator: 'new-validator', hash: 'new-hash' }),
      splitRefreshToken: jest.fn(),
      validatorMatchesHash: jest.fn(),
    };
    service = new AuthService(
      userRepository as unknown as UserRepository,
      cacheRepository as unknown as CacheRepository,
      sessionRepository as unknown as SessionRepository,
      tokenService as unknown as TokenService
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

    it('throws UnauthorizedError when the user does not exist', async () => {
      userRepository.findByUsername.mockResolvedValueOnce(null);

      await expect(
        service.login({ username: 'missing', password: 'password123456' })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError when the password does not match', async () => {
      userRepository.findByUsername.mockResolvedValueOnce(storedUser);
      (compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.login({ username: 'testuser', password: 'wrongpassword' })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('creates a session, caches the profile, and returns both tokens', async () => {
      userRepository.findByUsername.mockResolvedValueOnce(storedUser);
      (compare as jest.Mock).mockResolvedValueOnce(true);

      const result = await service.login({
        username: 'testuser',
        password: 'password123456',
      });

      expect(result.accessToken).toBe('signed-access-token');
      expect(result.refreshToken).toMatch(/^.+\.new-validator$/);
      expect(result.user).toEqual({
        id: 'user-1',
        name: 'Test User',
        username: 'testuser',
        email: 'test@example.com',
        role: 'user',
      });
      expect(sessionRepository.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          userId: 'user-1',
          refreshTokenHash: 'new-hash',
        })
      );
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
      tokenService.splitRefreshToken.mockReturnValueOnce({
        sessionId: 'session-1',
        validator: 'the-validator',
      });
      sessionRepository.get.mockResolvedValueOnce(null);

      await expect(service.refresh('session-1.the-validator')).rejects.toThrow(
        UnauthorizedError
      );
    });

    it('deletes the session and throws when the validator hash does not match (reuse detection)', async () => {
      tokenService.splitRefreshToken.mockReturnValueOnce({
        sessionId: 'session-1',
        validator: 'stolen-validator',
      });
      sessionRepository.get.mockResolvedValueOnce(storedSession);
      tokenService.validatorMatchesHash.mockReturnValueOnce(false);

      await expect(
        service.refresh('session-1.stolen-validator')
      ).rejects.toThrow(UnauthorizedError);
      expect(sessionRepository.delete).toHaveBeenCalledWith('session-1');
    });

    it('rotates the session and returns new tokens on a valid refresh', async () => {
      tokenService.splitRefreshToken.mockReturnValueOnce({
        sessionId: 'session-1',
        validator: 'current-validator',
      });
      sessionRepository.get.mockResolvedValueOnce(storedSession);
      tokenService.validatorMatchesHash.mockReturnValueOnce(true);

      const result = await service.refresh('session-1.current-validator');

      expect(result.accessToken).toBe('signed-access-token');
      expect(result.refreshToken).toBe('session-1.new-validator');
      expect(tokenService.signAccessToken).toHaveBeenCalledWith(
        'user-1',
        'session-1',
        'user'
      );
      expect(sessionRepository.set).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          userId: 'user-1',
          refreshTokenHash: 'new-hash',
          createdAt: storedSession.createdAt,
        })
      );
      expect(sessionRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('throws UnauthorizedError when no sessionId is provided', async () => {
      await expect(service.logout(undefined)).rejects.toThrow(
        UnauthorizedError
      );
    });

    it('deletes the session', async () => {
      await service.logout('session-1');

      expect(sessionRepository.delete).toHaveBeenCalledWith('session-1');
    });
  });
});
