import { randomUUID } from 'crypto';
import { compare } from 'bcryptjs';
import { z } from 'zod';
import { UnauthorizedError, ValidationError } from '../errors/AppError';
import { logger } from '../logger';
import { CacheRepository } from '../repositories/CacheRepository';
import {
  DEFAULT_TTL_SECONDS as REFRESH_TOKEN_TTL_SECONDS,
  SessionRepository,
} from '../repositories/SessionRepository';
import { UserRepository } from '../repositories/UserRepository';
import { toPublicUser, UserPublic, UserRole } from '../types/user';
import { parseOrThrow } from '../validation/parse';
import { TokenService } from './TokenService';

const CREDENTIALS_REQUIRED_MESSAGE = 'Username and password are required.';

const loginSchema = z.object({
  username: z
    .string({ error: CREDENTIALS_REQUIRED_MESSAGE })
    .trim()
    .min(1, CREDENTIALS_REQUIRED_MESSAGE),
  password: z
    .string({ error: CREDENTIALS_REQUIRED_MESSAGE })
    .min(1, CREDENTIALS_REQUIRED_MESSAGE),
});

export type LoginInput = z.infer<typeof loginSchema>;

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
    private readonly tokenService: TokenService
  ) {}

  async login(rawInput: unknown): Promise<LoginResult> {
    const { username, password } = parseOrThrow(loginSchema, rawInput);

    const user = await this.userRepository.findByUsername(username);

    if (!user) {
      throw new UnauthorizedError('Invalid credentials.');
    }

    const passwordMatch = await compare(password, user.password);

    if (!passwordMatch) {
      throw new UnauthorizedError('Invalid credentials.');
    }

    const sessionId = randomUUID();
    const { accessToken, refreshToken } = await this.issueSession(
      user.id,
      sessionId,
      user.role
    );
    const publicUser = toPublicUser(user);

    // The session write above must fail the login if Redis is unreachable;
    // this cache write is a performance optimization, not part of the auth
    // contract, so it must not fail a login with valid credentials.
    try {
      await this.cacheRepository.setUserProfile(user.id, publicUser);
    } catch (error) {
      logger.error({ err: error }, 'Failed to cache user profile after login');
    }

    return { accessToken, refreshToken, user: publicUser };
  }

  async refresh(rawRefreshToken?: string): Promise<RefreshResult> {
    if (!rawRefreshToken) {
      throw new ValidationError('Refresh token is required.');
    }

    const split = this.tokenService.splitRefreshToken(rawRefreshToken);

    if (!split) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    const { sessionId, validator } = split;
    const session = await this.sessionRepository.get(sessionId);

    if (!session) {
      throw new UnauthorizedError('Invalid refresh token.');
    }

    const hashMatches = this.tokenService.validatorMatchesHash(
      validator,
      session.refreshTokenHash
    );

    if (!hashMatches) {
      await this.sessionRepository.delete(sessionId);
      throw new UnauthorizedError('Invalid refresh token.');
    }

    return this.issueSession(
      session.userId,
      sessionId,
      session.role,
      session.createdAt
    );
  }

  async logout(sessionId?: string): Promise<void> {
    if (!sessionId) {
      throw new UnauthorizedError('Session is required.');
    }

    await this.sessionRepository.delete(sessionId);
  }

  private async issueSession(
    userId: string,
    sessionId: string,
    role: UserRole,
    createdAt: number = Date.now()
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const { validator, hash } = this.tokenService.generateRefreshToken();

    await this.sessionRepository.set(sessionId, {
      userId,
      role,
      refreshTokenHash: hash,
      createdAt,
      expiresAt: Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
    });

    const accessToken = this.tokenService.signAccessToken(
      userId,
      sessionId,
      role
    );
    const refreshToken = `${sessionId}.${validator}`;

    return { accessToken, refreshToken };
  }
}
