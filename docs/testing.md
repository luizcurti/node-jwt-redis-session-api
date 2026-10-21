# Testing

## Tiers

| Tier        | Location                                         | What it covers                                                               |
| ----------- | ------------------------------------------------ | ---------------------------------------------------------------------------- |
| Unit        | `src/__tests__/unit/`                            | Every branch, with PostgreSQL, Redis, bcrypt and JWT mocked                  |
| Integration | `src/__tests__/integration/`                     | Repositories, Lua scripts and services against real PostgreSQL + Redis       |
| E2E         | `src/__tests__/e2e/`                             | The real Express app and middleware chain (rate limits included), no mocks   |
| Collection  | `jwt-redis-session-api.postman_collection.json`  | Black-box HTTP against a running instance — in CI, the built Docker image    |

## Running them

```bash
npm test                     # unit, no infrastructure needed

docker compose up -d postgres redis
npm run migrate
npm run test:integration     # integration
npm run test:e2e             # e2e
npm run coverage:all         # unit + integration + e2e with a coverage report

docker compose up -d --build # full stack
npm run test:collection      # Newman; set METRICS_TOKEN to the server's value
```

Integration and e2e tests read `POSTGRES_*`, `REDIS_*` and `JWT_SECRET` from the environment; unset ones default to `localhost`, user `user`, password `password`, database `mydb`, and a test-only `JWT_SECRET` (`src/__tests__/testSetup/testEnv.js`). Redis without a password is supported (`REDIS_PASSWORD` unset). Their Jest `globalSetup` applies the real migrations before the run, and `globalTeardown` truncates the tables and flushes Redis afterwards.

`jest.config.js` enforces a 90% coverage floor (`coverageThreshold`) as a CI gate; the suite is currently at 100% statements, branches, functions and lines.

## Notable cases

Beyond the happy/sad matrix for every endpoint:

- **JWT edge cases** (`TokenService.test.ts`): malformed token, wrong signature, expired token, and an **algorithm-confusion attack** — a token signed with a different algorithm (`HS384`) or the unsigned `"alg": "none"` trick, both rejected because `algorithms: ['HS256']` is passed explicitly to `jsonwebtoken.verify`, not left as an implicit default.
- **Auth edge cases**: wrong password, unknown user (which must still run bcrypt against a dummy hash — asserted in `AuthService.test.ts`), malformed `Authorization` header/scheme, a session that belongs to a different user than the token's `sub`, the failed-login backoff (exact `1s, 2s, 4s…` lock TTLs against real Redis in `LoginThrottle.integration.test.ts`, and a real `429` + `Retry-After` in the e2e suite).
- **Session lifecycle** (`SessionRepository.integration.test.ts`, `AuthService.integration.test.ts`, e2e): the absolute lifetime is never extended by refresh; a token replayed within the grace period gets `409` and leaves the session alive; replayed after it, the whole session is deleted; `logout-all` revokes every session of one user and none of anyone else's; a user deleted from PostgreSQL can't refresh and loses every session.
- **Redis failure modes**: cache hit, cache miss with PostgreSQL fallback, the cache read/write itself failing (mocked at the unit level, `UserService.test.ts`/`AuthService.test.ts`), and — the one worth calling out — **a cache entry that isn't valid JSON** (`CacheRepository.test.ts` + its integration test + an e2e test that writes garbage directly into Redis and confirms the endpoint still returns `200` via the PostgreSQL fallback instead of a `500`).
- **Concurrency / race conditions**: two simultaneous signups for the same username, and separately for the same email, both against a real PostgreSQL instance (`UserRepository.integration.test.ts`) — asserting that exactly one `create()` call succeeds and the other gets a clean `ConflictError`, not an unhandled `500`. Twenty concurrent rotations of the same refresh token against real Redis, asserting exactly one wins — the case a non-atomic `GET`/compare/`SET` would fail. And two simultaneous `AuthService.refresh` calls, asserting one `200`, one `409`, and a session that survives.
- **RBAC and pagination** (`rbac.test.ts`, `ListUsersController.test.ts`, `UserRepository` tests): a non-admin gets `403` from `requireRole`, invalid `limit`/`offset` get `400`. The role is read from the JWT per request but from PostgreSQL per refresh, and the e2e suite proves both halves: a mid-session promotion does **not** unlock `/v1/admin/users` on the already-issued access token, and **does** from the next refresh on — no new login needed.
- **Rate limiting is tested through the real middleware chain** — limiters are never skipped under `NODE_ENV=test`. `createApp({ rateLimits })` injects tight limits for e2e tests that assert real `429`s per IP on login and per session on refresh, and that `X-Forwarded-For` is ignored unless `trust proxy` is configured. `rateLimiter.integration.test.ts` also asserts two independent limiter instances (standing in for two app replicas) share one Redis counter — the thing an in-memory `MemoryStore` cannot do.
- **Schema** (`UserRepository.integration.test.ts`): usernames that differ only in case collide with a `409`, `updated_at` is bumped by the trigger, and an `INSERT` without an id gets one from `gen_random_uuid()`.
- **Infra helpers** (`trustProxy.test.ts`, `metricsGuard.test.ts`, `logger.test.ts`): `TRUST_PROXY=true` is refused; `/metrics` answers `401` for a wrong token and `404` in production with none configured; an unsafe or over-long `X-Request-Id` is replaced instead of echoed.
