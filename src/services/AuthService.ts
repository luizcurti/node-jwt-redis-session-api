import { randomUUID } from 'crypto';
import { compare } from 'bcryptjs';
import { z } from 'zod';
import {
  ConflictError,
  UnauthorizedError,
  ValidationError,
} from '../errors/AppError';
import { logger } from '../logger';
import { CacheRepository } from '../repositories/CacheRepository';
import {
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS,
  SessionRepository,
} from '../repositories/SessionRepository';
import { UserRepository } from '../repositories/UserRepository';
import { toPublicUser, UserPublic } from '../types/user';
import { parseOrThrow } from '../validation/parse';
import { LoginThrottle } from './LoginThrottle';
import { TokenService } from './TokenService';

const CREDENTIALS_REQUIRED_MESSAGE = 'Username and password are required.';
const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid refresh token.';

// A real bcrypt hash (cost 12, same as UserService) of a random value
// nobody knows. Compared against when the username doesn't exist, so an
// unknown username costs the same ~bcrypt time as a wrong password and
// response timing doesn't reveal which usernames are registered.
const DUMMY_PASSWORD_HASH =
  '$2b$12$N8DZ7uzc8TAyWiPvYcdXoOWfKC0ALogP42AwN.hdaE9tXoaZqYWUu';

const loginSchema = z.object({
  username: z
    .string({ error: CREDENTIALS_REQUIRED_MESSAGE })
    .trim()
    .min(1, CREDENTIALS_REQUIRED_MESSAGE),
  password: z
    .string({ error: CREDENTIALS_REQUIRED_MESSAGE })
    .min(1, CREDENTIALS_REQUIRED_MESSAGE),
});

export type LoginResult = {
  accessToken: string;
  refreshToken: string;
  user: UserPublic;
};

export type RefreshResult = {
  accessToken: string;
  refreshToken: string;
};

export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly cacheRepository: CacheRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly tokenService: TokenService,
    private readonly loginThrottle: LoginThrottle
  ) {}

  async login(rawInput: unknown): Promise<LoginResult> {
    const { username, password } = parseOrThrow(loginSchema, rawInput);

    await this.loginThrottle.assertNotThrottled(username);

    const user = await this.userRepository.findByUsername(username);
    const passwordMatch = await compare(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH
    );

    if (!user || !passwordMatch) {
      await this.loginThrottle.recordFailure(username);
      throw new UnauthorizedError('Invalid credentials.');
    }

    await this.loginThrottle.reset(username);

    const sessionId = randomUUID();
    const { validator, hash } = this.tokenService.generateRefreshToken();
    const now = Date.now();

    await this.sessionRepository.create(sessionId, {
      userId: user.id,
      role: user.role,
      refreshTokenHash: hash,
      createdAt: now,
      expiresAt: now + SESSION_IDLE_TTL_SECONDS * 1000,
      absoluteExpiresAt: now + SESSION_ABSOLUTE_TTL_SECONDS * 1000,
    });

    const publicUser = toPublicUser(user);

    // The session write above must fail the login if Redis is unreachable;
    // this cache write is a performance optimization, not part of the auth
    // contract, so it must not fail a login with valid credentials.
    try {
      await this.cacheRepository.setUserProfile(user.id, publicUser);
    } catch (error) {
      logger.error({ err: error }, 'Failed to cache user profile after login');
    }

    return {
      accessToken: this.tokenService.signAccessToken(
        user.id,
        sessionId,
        user.role
      ),
      refreshToken: `${sessionId}.${validator}`,
      user: publicUser,
    };
  }

  async refresh(rawRefreshToken?: string): Promise<RefreshResult> {
    if (!rawRefreshToken) {
      throw new ValidationError('Refresh token is required.');
    }

    const split = this.tokenService.splitRefreshToken(rawRefreshToken);

    if (!split) {
      throw new UnauthorizedError(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const { sessionId, validator } = split;
    const session = await this.sessionRepository.get(sessionId);

    if (!session) {
      throw new UnauthorizedError(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    // Re-read the user on every refresh (once per access-token lifetime,
    // not per request): a deleted account loses all its sessions, and a
    // role change reaches the next access token instead of waiting for a
    // login that a long-lived, continuously refreshed session may never do.
    const user = await this.userRepository.findById(session.userId);

    if (!user) {
      await this.sessionRepository.deleteAllForUser(session.userId);
      throw new UnauthorizedError(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const next = this.tokenService.generateRefreshToken();
    const outcome = await this.sessionRepository.rotate(
      sessionId,
      session.userId,
      {
        presentedHash: this.tokenService.hashRefreshValidator(validator),
        newHash: next.hash,
        role: user.role,
        now: Date.now(),
      }
    );

    switch (outcome) {
      case 'rotated':
        return {
          accessToken: this.tokenService.signAccessToken(
            user.id,
            sessionId,
            user.role
          ),
          refreshToken: `${sessionId}.${next.validator}`,
        };
      case 'concurrent':
        throw new ConflictError(
          'Refresh token was already rotated by a concurrent request.'
        );
      case 'reused':
        logger.warn(
          { sessionId, userId: session.userId },
          'Refresh token reuse detected, session revoked'
        );
        throw new UnauthorizedError(INVALID_REFRESH_TOKEN_MESSAGE);
      default:
        throw new UnauthorizedError(INVALID_REFRESH_TOKEN_MESSAGE);
    }
  }

  async logout(sessionId?: string, userId?: string): Promise<void> {
    if (!sessionId || !userId) {
      throw new UnauthorizedError('Session is required.');
    }

    await this.sessionRepository.delete(sessionId, userId);
  }

  async logoutAll(userId?: string): Promise<number> {
    if (!userId) {
      throw new UnauthorizedError('Session is required.');
    }

    return this.sessionRepository.deleteAllForUser(userId);
  }
}
