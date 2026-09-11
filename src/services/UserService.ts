import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../errors/AppError';
import { logger } from '../logger';
import { CacheRepository } from '../repositories/CacheRepository';
import { UserRepository } from '../repositories/UserRepository';
import { toPublicUser, UserPublic } from '../types/user';
import { parseOrThrow } from '../validation/parse';

const BCRYPT_SALT_ROUNDS = 12;
// bcrypt silently truncates input beyond 72 bytes — anything longer would
// hash identically regardless of what follows, so it's rejected outright
// instead of quietly ignored.
const MAX_PASSWORD_LENGTH = 72;

const createUserSchema = z.object({
  username: z
    .string({ error: 'Username is required.' })
    .trim()
    .min(3, 'Username must be at least 3 characters.')
    .max(30, 'Username must be at most 30 characters.'),
  name: z
    .string({ error: 'Name is required.' })
    .trim()
    .min(2, 'Name must be at least 2 characters.')
    .max(100, 'Name must be at most 100 characters.'),
  email: z
    .string({ error: 'Email is required.' })
    .trim()
    .toLowerCase()
    .email('Email must be a valid email address.'),
  password: z
    .string({ error: 'Password is required.' })
    .min(12, 'Password must be at least 12 characters.')
    .max(
      MAX_PASSWORD_LENGTH,
      `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`
    ),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly cacheRepository: CacheRepository
  ) {}

  async createUser(rawInput: unknown): Promise<{ id: string }> {
    const { username, name, password, email } = parseOrThrow(
      createUserSchema,
      rawInput
    );

    const usernameTaken = await this.userRepository.existsByUsername(username);

    if (usernameTaken) {
      throw new ConflictError('Username already taken.');
    }

    const emailTaken = await this.userRepository.existsByEmail(email);

    if (emailTaken) {
      throw new ConflictError('Email already registered.');
    }

    const passwordHash = await hash(password, BCRYPT_SALT_ROUNDS);
    const id = randomUUID();

    await this.userRepository.create({
      id,
      name,
      username,
      passwordHash,
      email,
    });

    return { id };
  }

  async getUserProfile(
    requestingUserId: string,
    targetUserId: string
  ): Promise<UserPublic> {
    if (requestingUserId !== targetUserId) {
      throw new ForbiddenError('You are not allowed to access this profile.');
    }

    // Read-through cache: the cache read and repopulation are both
    // best-effort. PostgreSQL is the source of truth, so a Redis outage
    // degrades this endpoint's latency, not its availability.
    const cached = await this.readCachedProfile(targetUserId);

    if (cached) {
      return cached;
    }

    const user = await this.userRepository.findById(targetUserId);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    const profile = toPublicUser(user);

    try {
      await this.cacheRepository.setUserProfile(targetUserId, profile);
    } catch (error) {
      logger.error({ err: error }, 'Failed to repopulate profile cache');
    }

    return profile;
  }

  private async readCachedProfile(userId: string): Promise<UserPublic | null> {
    try {
      return await this.cacheRepository.getUserProfile(userId);
    } catch (error) {
      logger.error(
        { err: error },
        'Failed to read profile cache, falling back to PostgreSQL'
      );
      return null;
    }
  }
}
