# Security — Implementation Details

The README's Security section is the short version. This is the long version — the actual mechanisms and why each one is shaped the way it is.

## Content Security Policy

Helmet's default Content-Security-Policy is enabled **globally**, `/docs` included — it is not disabled or weakened anywhere. `swagger-ui-express`'s init script is served same-origin (`<script src="./swagger-ui-init.js">`, not inlined), so `script-src 'self'` already covers it; the only inline content on that page is `<style>` blocks and CSS-embedded `data:` image URIs, both already allowed by Helmet's defaults (`style-src` includes `'unsafe-inline'`, `img-src` includes `data:`). No route-specific CSP override was needed.

## Rate limiting, layer by layer

Rate limiting is layered (`src/middleware/rateLimiter.ts`), all of it counted in Redis (`rate-limit-redis` for the generic factory, a hand-rolled `INCR`/`EXPIRE` for the per-username one) rather than the default in-memory store, so every limit holds across multiple app replicas behind a load balancer, not just per-process:

- `POST /v1/login` and `POST /v1/auth/refresh` are each rate-limited to 10 requests per 15 minutes per IP, to slow down credential-stuffing/brute-force and refresh-token-guessing attempts. A per-IP limit alone can be bypassed against one targeted account by distributing attempts across many IPs, so `POST /v1/login` also enforces a second, independent limit of 10 requests per 15 minutes per **normalized username** (`login:user:{username}` in Redis) — an attacker has to clear both.
- Every other `/v1` route gets a baseline limit of 100 requests per minute per IP (`router.use(apiRateLimiter)`), so an authenticated-but-compromised client, or a client with no endpoint-specific limiter in its chain (e.g. `GET /v1/users/profile/:id`, `POST /v1/auth/logout`, `GET /v1/admin/users`), still can't hammer PostgreSQL/Redis at an unbounded rate. This was added specifically because CodeQL's `js/missing-rate-limiting` query flags any route that touches a database without a rate limiter in its own middleware chain, and `authentication` alone doesn't satisfy that query — a stacked, coarser limit does, and is also a real improvement, not just a query-pleaser.
- `GET /ready` and `GET /metrics` have no auth in front of them and each do real work, so both get their own 60-requests-per-minute-per-IP limit.
- All limiters are skipped when `NODE_ENV=test` so they don't interfere with the test suites; the shared factory's actual blocking behavior is covered against a real Redis instance in `rateLimiter.integration.test.ts`.

## JWT issuer/audience

Access tokens set and verify explicit `issuer`/`audience` claims (`src/services/TokenService.ts`), not just a signature check — a token that's otherwise validly signed but was issued for a different service (or replayed against this one from elsewhere) is rejected. Combined with the explicit `algorithms: ['HS256']` allowlist already in place, `jsonwebtoken.verify` is never left to its defaults for anything security-relevant.

## RBAC on `/v1/admin/users`

`GET /v1/admin/users` is gated by role-based access control, not just authentication — see the README's [Authentication Flow](../README.md#authentication-flow) for how a user becomes an admin (there is no self-service path) and why a role change doesn't take effect until the next login.

## Refresh-token reuse detection

Refresh tokens are never stored in Redis as plaintext — only a SHA-256 hash. A refresh token that fails to match its session's stored hash is treated as **reuse of a stolen or already-rotated token**, and the entire session is deleted immediately rather than just rejecting that one request.

## Redis as a hard dependency for auth

Redis is a **mandatory dependency for authentication**, not an optional cache: session creation (`SessionRepository`) is what `POST /v1/login` and `POST /v1/auth/refresh` rely on to issue tokens at all, and if Redis is unreachable those calls fail loudly. Every other Redis touchpoint (`CacheRepository`, used by the profile cache on login and by `GET /v1/users/profile/:id`) is best-effort — a failure there is logged and swallowed, falling back to PostgreSQL where possible, rather than failing a request that PostgreSQL could otherwise satisfy.

## `JWT_SECRET` minimum length

`JWT_SECRET` must be at least 32 characters (`src/services/TokenService.ts`) — a bare "is it set?" check doesn't stop someone from using a trivially short/guessable secret. `docker-compose.yml` has **no default** for it either; `docker-compose up` fails fast with a clear error if it's missing rather than silently starting with a predictable secret. There is no dev-vs-production split — the same floor applies everywhere, since a "convenient" weak default in development is exactly the kind of thing that quietly ends up in a production deploy.
