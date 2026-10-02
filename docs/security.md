# Security — Implementation Details

The README's Security section is the short version. This is the long version — the actual mechanisms and why each one is shaped the way it is.

## Session lifecycle

Every login creates a Redis session (`session:{sessionId}`) holding `userId`, `role`, the SHA-256 hash of the current refresh-token validator, and three timestamps:

| Field               | Meaning                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `expiresAt`         | Idle expiry — 7 days after the last refresh. Each refresh slides it forward.                            |
| `absoluteExpiresAt` | Hard cap — 30 days after login. Refresh **never** extends it; the Redis TTL is `min(7d, time left)`.    |
| `rotatedAt`         | When the current refresh token was issued — used only for the concurrent-refresh grace period below.   |

Without the absolute cap, a client that refreshes at least once a week would never have to log in again — and anything denormalized into the session at login would stay frozen forever.

### Rotation is an atomic compare-and-swap

`SessionRepository.rotate` is a single Lua script: read the session, compare the presented hash, write the new one. Redis runs scripts atomically, so two requests carrying the same valid refresh token can't both read the old hash before either writes — exactly one gets `rotated` (`SessionRepository.integration.test.ts` fires 20 concurrent rotations and asserts exactly one wins). A plain `GET` → compare in Node → `SET` would let both through and silently defeat reuse detection.

The hash comparison happens in Lua, so it isn't constant-time. That's acceptable here: both sides are SHA-256 digests, and an attacker can't choose the bytes of a digest to probe it prefix by prefix.

### Reuse detection, with a grace period for benign races

| Presented hash                                   | Outcome                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| matches the current one                          | `200`, rotated                                                                                 |
| matches the **previous** one, rotated < 30 s ago | `409` — "already rotated by a concurrent request"; the session is left alive                   |
| anything else                                    | `401`, and the **whole session is deleted** (OAuth 2.0 Security BCP refresh-token reuse detection) |

Two browser tabs refreshing at the same moment is the classic false positive of strict reuse detection: one tab wins, the other presents the now-stale token and logs the user out. The grace window turns that into a `409` the client can recover from (re-read the newest token from shared storage, retry).

The window deliberately does **not** "return the same pair again", as some providers do — that would require storing the raw successor token, breaking the invariant that Redis only ever holds hashes. The trade-off: a thief who replays a stolen token within 30 s of the legitimate rotation gets a `409` instead of triggering the kill switch. They still get no tokens, and any later replay is caught.

### The role is re-read on refresh

`AuthService.refresh` loads the user from PostgreSQL before rotating — one query per refresh (every ~15 min per session), not per request. So:

- a **role change** reaches the next access token within one access-token lifetime, without waiting for a login that a long-lived session might never do;
- a **deleted user** can't refresh at all — every one of their sessions is revoked on the spot.

The auth middleware still never touches PostgreSQL: the role on the access token is at most 15 minutes stale. For instant demotion, revoke the user's sessions (below).

### Revoking every session of a user

Each session id is also added to `user_sessions:{userId}` (a Redis set, in the same `MULTI` as the session write). That reverse index is what makes `POST /v1/auth/logout-all` possible: `SessionRepository.deleteAllForUser` deletes every session in the set in one Lua script. The set's TTL is re-extended to the absolute lifetime on every login, so it always outlives the sessions in it; stale members (sessions that expired on their own) are harmless, since `DEL` on a missing key is a no-op.

The auth middleware also rejects a session whose `userId` doesn't match the token's `sub` — that can only mean a forged or mis-issued token.

## Login brute-force protection

Two independent layers, both counted in Redis:

1. **Per IP** — `POST /v1/login` allows 20 requests per 15 minutes per client IP (`express-rate-limit` + `rate-limit-redis`).
2. **Per account** — `LoginThrottle` (`src/services/LoginThrottle.ts`), called from `AuthService.login`:
   - only **failed** logins count (successful ones reset the counter);
   - the first 5 failures within 15 minutes are free;
   - each failure after that arms a lock of 1 s, 2 s, 4 s, … capped at 15 minutes, answered with `429` + `Retry-After`.

A per-IP limit alone is bypassed by spreading attempts across many IPs. A hard per-account lockout ("10 attempts, then blocked for 15 min") has the opposite problem: anyone who knows a username can lock its owner out with 10 requests. Progressive backoff keeps online guessing impractical (a few hundred guesses a day at most) while making targeted lockout cheap to recover from. The next step, if needed, would be a CAPTCHA after N failures.

`INCR`, the first-failure `EXPIRE`, and the lock `SET` run as one Lua script. A bare `INCR` followed by a separate `EXPIRE` can crash in between and leave a counter with no TTL — an account throttled forever.

Usernames match case-insensitively everywhere (`lower(username)` in SQL, a lowercased key in Redis), backed by a unique index on `lower(username)`. `Luiz` and `luiz` can't be two accounts.

### No username enumeration through timing

When the username doesn't exist, `AuthService.login` still runs `bcrypt.compare` against a fixed dummy hash of the same cost (12). An unknown username and a wrong password take the same time and give the same `401 Invalid credentials.`, and both count toward the throttle.

## Refresh rate limiting is per session, not per IP

`POST /v1/auth/refresh` allows 10 requests per 15 minutes **per session id** (`refreshTokenSessionKey` in `src/middleware/rateLimiter.ts`). A per-IP refresh limit would put every user behind one office NAT or mobile CGNAT address into a single bucket — and with 15-minute access tokens, more than 10 such users would start getting logged out together. The validator half of a refresh token is a 256-bit secret, so guessing isn't the threat a per-IP limit would address. Requests with no parseable token fall back to the IP, and every request also passes the per-IP baseline limiter.

## Rate limiting, layer by layer

| Layer                 | Key                        | Limit             |
| --------------------- | -------------------------- | ----------------- |
| Every `/v1` route     | client IP                  | 100 / min         |
| `POST /v1/login`      | client IP                  | 20 / 15 min       |
| `POST /v1/login`      | normalized username        | backoff after 5 failures |
| `POST /v1/auth/refresh` | session id               | 10 / 15 min       |
| `/ready`, `/metrics`  | client IP                  | 60 / min          |

All counters live in Redis rather than the default in-memory store, so every limit holds across app replicas, not per process. The baseline limiter on every `/v1` route also exists because CodeQL's `js/missing-rate-limiting` query flags any route that touches a database without one in its own chain — and it's a real improvement, not just a query-pleaser.

Limits are **never** switched off by `NODE_ENV`. Tests get the real middleware chain; `createApp({ rateLimits })` injects whatever limits a test needs (generous ones by default, tight ones in the e2e tests that assert real `429`s). Skipping limiters under `NODE_ENV=test` would both leave the real chain untested and turn a mis-set `NODE_ENV` in production into "no rate limiting at all".

### `trust proxy`

Behind a load balancer every request arrives from the proxy's IP, so every per-IP limit would collapse into one shared bucket. `TRUST_PROXY` tells Express which hops to believe `X-Forwarded-For` from — a hop count (`1`) or a subnet list (`loopback, 10.0.0.0/8`). It defaults to `false`, and `TRUST_PROXY=true` is **refused at startup**: it would trust whatever `X-Forwarded-For` a client sends, letting anyone pick their own IP and walk around every per-IP limit.

## JWT

Access tokens set and verify explicit `issuer`/`audience` claims, and `jsonwebtoken.verify` gets an explicit `algorithms: ['HS256']` allowlist — never left to its defaults for anything security-relevant. A token signed for another service, signed with another algorithm (`HS384`), or unsigned (`alg: none`) is rejected.

`JWT_SECRET` must be at least 32 characters (RFC 7518 recommends a key at least as long as the HMAC output for HS256). `docker-compose.yml` has no default for it; `docker compose up` fails fast with a clear error if it's missing.

**Known trade-off — HS256 with one shared secret.** Any service that needs to *verify* these tokens also gets the power to *mint* them, and there is no `kid`-based key rotation: changing the secret logs everyone out at once. For a single API that issues and verifies its own tokens, that's the right amount of machinery; an asymmetric algorithm (EdDSA or RS256) with a JWKS and `kid` headers only pays off when other services must verify tokens without being able to mint them.

## `/metrics` access

`/metrics` exposes route names, latencies, and process internals. With `METRICS_TOKEN` set, scrapers must send `Authorization: Bearer <token>` (compared in constant time over SHA-256 digests, which also hides the token's length). Without it, the endpoint is open in development and returns `404` in production — a forgotten env var fails closed, not open.

## Infrastructure

- **Redis** requires a password (`requirepass`, from `REDIS_PASSWORD` — no default), persists to a volume with AOF (sessions survive a container recreate), and has `maxmemory 200mb` below its 256 MB container limit. Redis doesn't read cgroup limits; without `maxmemory` it grows until the kernel OOM-kills it and every session vanishes at once.
- **Eviction policy is `noeviction`, not `volatile-lru`.** Every key here — sessions, profile cache, rate-limit counters — has a TTL, so `volatile-lru` would happily evict live sessions and silently log users out. With `noeviction`, a full Redis rejects writes instead: profile-cache writes are best-effort and degrade to PostgreSQL, logins fail loudly (`SessionRepository` surfaces errors from inside a `MULTI`). Sessions and cache share one instance, so cache pressure counts against the same memory as sessions.
- **PostgreSQL** has no default password either (`POSTGRES_PASSWORD` is required).
- **Ports** for PostgreSQL, Redis and the app are bound to `127.0.0.1` only — reachable from the host for local development, never from the network the host sits on.
- **Redis as a hard dependency for auth.** Session writes are what `POST /v1/login` and `POST /v1/auth/refresh` rely on to issue tokens at all; if Redis is unreachable they fail loudly. Every other Redis touchpoint (`CacheRepository`) is best-effort, falling back to PostgreSQL. `POST /v1/auth/refresh` also needs PostgreSQL (it re-reads the user) — the cost of fresh roles and revocation on deletion.

## Content Security Policy

Helmet's default Content-Security-Policy is enabled **globally**, `/docs` included — it is not disabled or weakened anywhere. `swagger-ui-express`'s init script is served same-origin (`<script src="./swagger-ui-init.js">`, not inlined), so `script-src 'self'` already covers it; the only inline content on that page is `<style>` blocks and CSS-embedded `data:` image URIs, both already allowed by Helmet's defaults. No route-specific CSP override was needed.
