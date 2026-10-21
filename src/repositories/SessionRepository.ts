import { ChainableCommander, Redis } from 'ioredis';
import { UserRole } from '../types/user';

// Sliding (idle) lifetime: a session unused for this long expires. Each
// refresh pushes it forward — but never past the absolute lifetime below.
export const SESSION_IDLE_TTL_SECONDS = 7 * 24 * 60 * 60;
// Hard cap from login, which refresh never extends: a client that keeps
// refreshing still has to log in again at least this often.
export const SESSION_ABSOLUTE_TTL_SECONDS = 30 * 24 * 60 * 60;
// How long the just-rotated-away refresh token is recognized as a benign
// concurrent refresh (two tabs racing) rather than as token theft.
export const REFRESH_GRACE_PERIOD_MS = 30 * 1000;

export type SessionRecord = {
  userId: string;
  // Denormalized from Postgres so the auth middleware never needs a DB
  // round trip. Re-read from Postgres on every refresh, so it is at most one
  // access-token lifetime (15 min) stale.
  role: UserRole;
  refreshTokenHash: string;
  // Hash of the token this one replaced, and when — only used to tell a
  // benign concurrent refresh apart from reuse within the grace period.
  previousRefreshTokenHash?: string;
  rotatedAt?: number;
  createdAt: number;
  expiresAt: number;
  absoluteExpiresAt: number;
};

export type RotateParams = {
  presentedHash: string;
  newHash: string;
  role: UserRole;
  now: number;
};

// - rotated: presented token was current; session now holds `newHash`.
// - concurrent: presented token was rotated away within the grace period by
//   another request — rejected, but the session is left alive.
// - reused: presented token is stale beyond the grace period — the session
//   has been deleted (OAuth 2.0 Security BCP refresh-token reuse detection).
// - missing: no such session, or it has hit its absolute lifetime.
export type RotateOutcome = 'rotated' | 'concurrent' | 'reused' | 'missing';

// Compare-and-swap in one Lua script: Redis runs it atomically, so two
// requests presenting the same valid token can't both read the old hash
// before either writes the new one — exactly one gets 'rotated'.
// Hash comparison here is not constant-time, which is fine: both sides are
// SHA-256 digests, and an attacker can't choose the bytes of a digest to
// probe it prefix by prefix.
const ROTATE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local s = cjson.decode(raw)
local presented = ARGV[1]
local now = tonumber(ARGV[4])

if s.refreshTokenHash ~= presented then
  if s.previousRefreshTokenHash == presented and s.rotatedAt
     and (now - s.rotatedAt) <= tonumber(ARGV[5]) then
    return 'concurrent'
  end
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[2], ARGV[7])
  return 'reused'
end

local remainingMs = s.absoluteExpiresAt - now
if remainingMs <= 0 then
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[2], ARGV[7])
  return 'missing'
end

local ttl = math.min(tonumber(ARGV[6]), math.ceil(remainingMs / 1000))
s.previousRefreshTokenHash = presented
s.refreshTokenHash = ARGV[2]
s.role = ARGV[3]
s.rotatedAt = now
s.expiresAt = now + ttl * 1000
redis.call('SET', KEYS[1], cjson.encode(s), 'EX', ttl)
return 'rotated'
`;

// Touches session keys it didn't declare in KEYS — fine on a single Redis
// node; on Redis Cluster the keys would need a shared {userId} hash tag.
const DELETE_ALL_SCRIPT = `
local ids = redis.call('SMEMBERS', KEYS[1])
for _, id in ipairs(ids) do
  redis.call('DEL', ARGV[1] .. id)
end
redis.call('DEL', KEYS[1])
return #ids
`;

const SESSION_PREFIX = 'session:';

function sessionKey(sessionId: string): string {
  return `${SESSION_PREFIX}${sessionId}`;
}

// Reverse index userId -> sessionIds, so every session of one user can be
// revoked at once (logout everywhere, account deletion, demotion, a
// compromised account). Members may outlive their session key (it expired
// on its own); DEL on a missing key is a no-op, so that's harmless.
function userSessionsKey(userId: string): string {
  return `user_sessions:${userId}`;
}

// A MULTI's exec() resolves even when a queued command fails (e.g. OOM
// under noeviction) — surface that instead of reporting success.
async function execOrThrow(transaction: ChainableCommander): Promise<void> {
  const results = await transaction.exec();

  for (const [error] of results ?? []) {
    if (error) {
      throw error;
    }
  }
}

export class SessionRepository {
  constructor(private readonly redisClient: Redis) {}

  async get(sessionId: string): Promise<SessionRecord | null> {
    const stored = await this.redisClient.get(sessionKey(sessionId));

    return stored ? (JSON.parse(stored) as SessionRecord) : null;
  }

  async create(sessionId: string, record: SessionRecord): Promise<void> {
    const ttlSeconds = Math.min(
      SESSION_IDLE_TTL_SECONDS,
      Math.ceil((record.absoluteExpiresAt - Date.now()) / 1000)
    );

    // The index outlives every session in it: a session can't live past
    // its absolute lifetime, and each new login re-extends the index.
    await execOrThrow(
      this.redisClient
        .multi()
        .set(sessionKey(sessionId), JSON.stringify(record), 'EX', ttlSeconds)
        .sadd(userSessionsKey(record.userId), sessionId)
        .expire(userSessionsKey(record.userId), SESSION_ABSOLUTE_TTL_SECONDS)
    );
  }

  async rotate(
    sessionId: string,
    userId: string,
    { presentedHash, newHash, role, now }: RotateParams
  ): Promise<RotateOutcome> {
    return (await this.redisClient.eval(
      ROTATE_SCRIPT,
      2,
      sessionKey(sessionId),
      userSessionsKey(userId),
      presentedHash,
      newHash,
      role,
      now,
      REFRESH_GRACE_PERIOD_MS,
      SESSION_IDLE_TTL_SECONDS,
      sessionId
    )) as RotateOutcome;
  }

  async delete(sessionId: string, userId: string): Promise<void> {
    await execOrThrow(
      this.redisClient
        .multi()
        .del(sessionKey(sessionId))
        .srem(userSessionsKey(userId), sessionId)
    );
  }

  async deleteAllForUser(userId: string): Promise<number> {
    return (await this.redisClient.eval(
      DELETE_ALL_SCRIPT,
      1,
      userSessionsKey(userId),
      SESSION_PREFIX
    )) as number;
  }
}
