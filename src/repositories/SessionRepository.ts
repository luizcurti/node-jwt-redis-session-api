import { Redis } from 'ioredis';
import { UserRole } from '../types/user';

export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

export type SessionRecord = {
  userId: string;
  // Denormalized from Postgres at login time so `refresh` can mint a new
  // access token without a DB round trip; fixed for the session's life,
  // so a role change takes effect only on the user's next login.
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
