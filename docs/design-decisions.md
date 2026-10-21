# Design Decisions

## 1. JWT *and* Redis sessions

A JWT alone can't be revoked before it expires. A server session alone needs a lookup per request anyway. Here the access token (15 min, HS256, explicit `iss`/`aud`/`alg`) carries a session id, and the auth middleware checks that session in Redis on every request. One O(1) Redis `GET` buys instant logout, `POST /v1/auth/logout-all`, and revocation of every session when an account is deleted.

## 2. Opaque refresh tokens, rotated atomically

A refresh token is `sessionId.validator`, where the validator is 256 random bits and Redis stores only its SHA-256 hash. Each refresh is a compare-and-swap in a single Lua script, so two requests with the same valid token can never both succeed. The outcome depends on which token was presented:

| Presented token                         | Result                                                      |
| --------------------------------------- | ----------------------------------------------------------- |
| current                                 | `200` with a new pair                                       |
| previous, rotated less than 30 s ago    | `409`; the session survives (two tabs raced)                |
| anything older                          | `401`, and the whole session is deleted (reuse detection)   |

## 3. Sessions have an absolute lifetime, and roles don't freeze

Refresh slides the 7-day idle expiry but never the 30-day absolute one. Each refresh also re-reads the user from PostgreSQL: a demoted admin loses the role within one access-token lifetime (15 min), and a deleted user loses every session. The auth middleware itself still never queries PostgreSQL.

## 4. Brute-force protection that an attacker can't turn against users

- **Per IP:** a limit on login requests.
- **Per account:** only failed attempts count. After 5 free failures, delays grow 1 s, 2 s, 4 s… up to a 15-minute cap (`429` + `Retry-After`), and a success resets them.
- **No hard lockout:** knowing someone's username isn't enough to lock them out.
- **No timing oracle:** unknown usernames still pay the bcrypt cost, against a dummy hash.
- **Refresh is limited per session, not per IP:** a whole office behind one NAT doesn't get logged out together.

## 5. PostgreSQL is the source of truth; Redis is fast state

Sessions, the profile cache, and rate-limit counters live in Redis. Users live in PostgreSQL, with raw parameterized SQL, plain-SQL migrations, and named constraints that `23505` errors map to `409`.

- **Cache misses fall back.** A miss, or a Redis outage, falls back to PostgreSQL, so `/v1/users/me` degrades in latency, not availability.
- **Redis is sized not to lose sessions.** It runs with a password, AOF persistence, `maxmemory`, and `noeviction`, because evicting under memory pressure would silently log users out.

## Trade-offs

| Decision                                      | Cost                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| Redis lookup on every authenticated request   | Redis becomes a hard dependency for auth                                                |
| Role re-read on refresh, not per request      | A role change can take up to 15 min to reach the access token (`logout-all` makes it immediate) |
| 30 s grace window for concurrent refresh      | A thief who replays within 30 s of a rotation gets a `409` instead of triggering the kill switch |
| Refresh needs PostgreSQL                      | One query per session every ~15 min, and refresh fails if PostgreSQL is down            |
| HS256 with one shared secret                  | Anything that can verify a token can mint one, and there is no `kid` rotation; [security.md](security.md#jwt) explains when to move to EdDSA + JWKS |
| One Redis for sessions, cache and counters    | Cache pressure counts against the same memory as sessions |
| Raw SQL, no ORM                               | Full control of queries and constraints, but more SQL to maintain                       |
