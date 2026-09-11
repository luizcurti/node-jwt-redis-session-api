import { Redis } from 'ioredis';
import { UserRole } from '../types/user';

export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

export type SessionRecord = {
  userId: string;
  // Denormalized from Postgres at login time so `AuthService.refresh` can
  // mint a new access token without a DB round trip. Stays fixed for the
  // life of the session — a role change only takes effect on the user's
  // next login, the same staleness window the access token's own 15-minute
  // expiry already implies.
  role: UserRole;
  refreshTokenHash: string;
  createdAt: number;
  expiresAt: number;
};

export class SessionRepository {
  constructor(private readonly redisClient: Redis) {}

  async get(sessionId: string): Promise<SessionRecord | null> {
    const stored = await this.redisClient.get(`session:${sessionId}`);

    return stored ? (JSON.parse(stored) as SessionRecord) : null;
  }

  async set(
    sessionId: string,
    record: SessionRecord,
    ttlSeconds = DEFAULT_TTL_SECONDS
  ): Promise<void> {
    await this.redisClient.set(
      `session:${sessionId}`,
      JSON.stringify(record),
      'EX',
      ttlSeconds
    );
  }

  async delete(sessionId: string): Promise<void> {
    await this.redisClient.del(`session:${sessionId}`);
  }
}
