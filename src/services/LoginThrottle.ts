import { Redis } from 'ioredis';
import { TooManyRequestsError } from '../errors/AppError';

export type LoginThrottleOptions = {
  // Failures allowed before any delay kicks in.
  freeAttempts?: number;
  baseDelaySeconds?: number;
  maxDelaySeconds?: number;
  // How long a failure keeps counting toward the backoff.
  failureWindowSeconds?: number;
};

// INCR + first-time EXPIRE + lock in one atomic script: a crash between a
// bare INCR and its EXPIRE would otherwise leave a counter with no TTL, and
// the account throttled forever.
const RECORD_FAILURE_SCRIPT = `
local failures = redis.call('INCR', KEYS[1])
if failures == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local excess = failures - tonumber(ARGV[2])
if excess > 0 then
  local delay = math.floor(math.min(tonumber(ARGV[3]) * 2 ^ (excess - 1), tonumber(ARGV[4])))
  redis.call('SET', KEYS[2], '1', 'EX', delay)
end
return failures
`;

function normalize(username: string): string {
  return username.trim().toLowerCase();
}

// Per-account brute-force protection, independent of the per-IP limiter —
// closes the gap where attempts are spread across many IPs against one
// account. Deliberately not a hard lockout: only *failed* logins count, the
// first few are free, and after that each failure only buys a short,
// exponentially growing delay (1s, 2s, 4s, ... capped at 15 min). Someone
// who merely knows a victim's username can slow their logins down, but
// can't lock them out for a fixed long window with a handful of requests,
// and a successful login clears everything.
export class LoginThrottle {
  private readonly freeAttempts: number;
  private readonly baseDelaySeconds: number;
  private readonly maxDelaySeconds: number;
  private readonly failureWindowSeconds: number;

  constructor(
    private readonly redisClient: Redis,
    {
      freeAttempts = 5,
      baseDelaySeconds = 1,
      maxDelaySeconds = 15 * 60,
      failureWindowSeconds = 15 * 60,
    }: LoginThrottleOptions = {}
  ) {
    this.freeAttempts = freeAttempts;
    this.baseDelaySeconds = baseDelaySeconds;
    this.maxDelaySeconds = maxDelaySeconds;
    this.failureWindowSeconds = failureWindowSeconds;
  }

  async assertNotThrottled(username: string): Promise<void> {
    const ttl = await this.redisClient.ttl(this.lockKey(username));

    if (ttl > 0) {
      throw new TooManyRequestsError(
        'Too many failed login attempts for this account. Please try again later.',
        ttl
      );
    }
  }

  async recordFailure(username: string): Promise<void> {
    await this.redisClient.eval(
      RECORD_FAILURE_SCRIPT,
      2,
      this.failuresKey(username),
      this.lockKey(username),
      this.failureWindowSeconds,
      this.freeAttempts,
      this.baseDelaySeconds,
      this.maxDelaySeconds
    );
  }

  async reset(username: string): Promise<void> {
    await this.redisClient.del(
      this.failuresKey(username),
      this.lockKey(username)
    );
  }

  private failuresKey(username: string): string {
    return `login:failures:${normalize(username)}`;
  }

  private lockKey(username: string): string {
    return `login:lock:${normalize(username)}`;
  }
}
