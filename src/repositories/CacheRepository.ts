import { Redis } from 'ioredis';
import { UserPublic } from '../types/user';

const DEFAULT_TTL_SECONDS = 3600;

export class CacheRepository {
  constructor(private readonly redisClient: Redis) {}

  async getUserProfile(userId: string): Promise<UserPublic | null> {
    const cached = await this.redisClient.get(`user-${userId}`);

    return cached ? (JSON.parse(cached) as UserPublic) : null;
  }

  async setUserProfile(
    userId: string,
    profile: UserPublic,
    ttlSeconds = DEFAULT_TTL_SECONDS
  ): Promise<void> {
    await this.redisClient.set(
      `user-${userId}`,
      JSON.stringify(profile),
      'EX',
      ttlSeconds
    );
  }
}
