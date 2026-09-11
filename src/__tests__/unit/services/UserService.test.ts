import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../errors/AppError';
import { logger } from '../../../logger';
import { CacheRepository } from '../../../repositories/CacheRepository';
import { UserRepository } from '../../../repositories/UserRepository';
import { UserService } from '../../../services/UserService';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
}));

describe('UserService', () => {
  let userRepository: jest.Mocked<
    Pick<
      UserRepository,
      | 'existsByUsername'
      | 'existsByEmail'
      | 'create'
      | 'findByUsername'
      | 'findById'
    >
  >;
  let cacheRepository: jest.Mocked<
    Pick<CacheRepository, 'getUserProfile' | 'setUserProfile'>
  >;
  let service: UserService;

  beforeEach(() => {
    userRepository = {
      existsByUsername: jest.fn(),
      existsByEmail: jest.fn(),
      create: jest.fn(),
      findByUsername: jest.fn(),
      findById: jest.fn(),
    };
    cacheRepository = {
      getUserProfile: jest.fn(),
      setUserProfile: jest.fn(),
    };
    service = new UserService(
      userRepository as unknown as UserRepository,
      cacheRepository as unknown as CacheRepository
    );
  });

  describe('createUser', () => {
    const validInput = {
      username: 'newuser',
      name: 'Test User',
      password: 'password123456',
      email: 'newuser@example.com',
    };

    it('throws ValidationError when a required field is missing', async () => {
      const promise = service.createUser({ username: 'newuser' });

      await expect(promise).rejects.toThrow(ValidationError);
      await expect(promise).rejects.toThrow('Name is required.');
      expect(userRepository.existsByUsername).not.toHaveBeenCalled();
    });

    it('throws ValidationError when the username is too short', async () => {
      await expect(
        service.createUser({ ...validInput, username: 'ab' })
      ).rejects.toThrow('Username must be at least 3 characters.');
    });

    it('throws ValidationError when the email is not a valid address', async () => {
      await expect(
        service.createUser({ ...validInput, email: 'not-an-email' })
      ).rejects.toThrow('Email must be a valid email address.');
    });

    it('throws ValidationError when the password is too short', async () => {
      await expect(
        service.createUser({ ...validInput, password: 'short' })
      ).rejects.toThrow('Password must be at least 12 characters.');
    });

    it('trims whitespace and lowercases the email before storing', async () => {
      userRepository.existsByUsername.mockResolvedValueOnce(false);
      userRepository.existsByEmail.mockResolvedValueOnce(false);

      await service.createUser({
        ...validInput,
        username: '  newuser  ',
        email: '  NewUser@Example.com  ',
      });

      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'newuser',
          email: 'newuser@example.com',
        })
      );
    });

    it('throws ConflictError when the username is already taken', async () => {
      userRepository.existsByUsername.mockResolvedValueOnce(true);

      await expect(service.createUser(validInput)).rejects.toThrow(
        ConflictError
      );
      expect(userRepository.existsByEmail).not.toHaveBeenCalled();
      expect(userRepository.create).not.toHaveBeenCalled();
    });

    it('throws ConflictError when the email is already registered', async () => {
      userRepository.existsByUsername.mockResolvedValueOnce(false);
      userRepository.existsByEmail.mockResolvedValueOnce(true);

      await expect(service.createUser(validInput)).rejects.toThrow(
        ConflictError
      );
      expect(userRepository.create).not.toHaveBeenCalled();
    });

    it('creates the user and returns the generated id', async () => {
      userRepository.existsByUsername.mockResolvedValueOnce(false);
      userRepository.existsByEmail.mockResolvedValueOnce(false);

      const result = await service.createUser(validInput);

      expect(result.id).toEqual(expect.any(String));
      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: result.id,
          name: validInput.name,
          username: validInput.username,
          passwordHash: 'hashed-password',
          email: validInput.email,
        })
      );
    });
  });

  describe('getUserProfile', () => {
    const profile = {
      id: 'user-a',
      name: 'Test',
      username: 'testuser',
      email: 'test@example.com',
    };
    const storedUser = { ...profile, password: 'hashed-password' };

    it('throws ForbiddenError when the requesting user is not the target user', async () => {
      await expect(service.getUserProfile('user-a', 'user-b')).rejects.toThrow(
        ForbiddenError
      );
      expect(cacheRepository.getUserProfile).not.toHaveBeenCalled();
    });

    it('returns the cached profile when the requester owns it (cache hit)', async () => {
      cacheRepository.getUserProfile.mockResolvedValueOnce(profile);

      await expect(service.getUserProfile('user-a', 'user-a')).resolves.toEqual(
        profile
      );
      expect(userRepository.findById).not.toHaveBeenCalled();
    });

    it('falls back to PostgreSQL and repopulates the cache on a cache miss', async () => {
      cacheRepository.getUserProfile.mockResolvedValueOnce(null);
      userRepository.findById.mockResolvedValueOnce(storedUser);

      await expect(service.getUserProfile('user-a', 'user-a')).resolves.toEqual(
        profile
      );
      expect(userRepository.findById).toHaveBeenCalledWith('user-a');
      expect(cacheRepository.setUserProfile).toHaveBeenCalledWith(
        'user-a',
        profile
      );
    });

    it('throws NotFoundError when the user exists in neither cache nor PostgreSQL', async () => {
      cacheRepository.getUserProfile.mockResolvedValueOnce(null);
      userRepository.findById.mockResolvedValueOnce(null);

      await expect(service.getUserProfile('user-a', 'user-a')).rejects.toThrow(
        NotFoundError
      );
      expect(cacheRepository.setUserProfile).not.toHaveBeenCalled();
    });

    it('falls back to PostgreSQL when the cache read itself fails', async () => {
      const loggerErrorSpy = jest
        .spyOn(logger, 'error')
        .mockImplementation(() => logger);
      cacheRepository.getUserProfile.mockRejectedValueOnce(
        new Error('redis unreachable')
      );
      userRepository.findById.mockResolvedValueOnce(storedUser);

      await expect(service.getUserProfile('user-a', 'user-a')).resolves.toEqual(
        profile
      );
      expect(loggerErrorSpy).toHaveBeenCalled();

      loggerErrorSpy.mockRestore();
    });

    it('still returns the profile when repopulating the cache fails', async () => {
      const loggerErrorSpy = jest
        .spyOn(logger, 'error')
        .mockImplementation(() => logger);
      cacheRepository.getUserProfile.mockResolvedValueOnce(null);
      userRepository.findById.mockResolvedValueOnce(storedUser);
      cacheRepository.setUserProfile.mockRejectedValueOnce(
        new Error('redis unreachable')
      );

      await expect(service.getUserProfile('user-a', 'user-a')).resolves.toEqual(
        profile
      );
      expect(loggerErrorSpy).toHaveBeenCalled();

      loggerErrorSpy.mockRestore();
    });
  });
});
