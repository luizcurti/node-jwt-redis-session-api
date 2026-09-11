# Observability — Implementation Details

## Structured logging

Every request is logged as one JSON line (`src/logger.ts`, via [pino](https://getpino.io) + `pino-http`) instead of ad hoc `console.log`:

```json
{
  "level": "info",
  "time": 1728666000000,
  "pid": 1234,
  "hostname": "...",
  "requestId": "3f9e...-uuid",
  "req": { "method": "POST", "path": "/v1/login" },
  "res": { "status": 200 },
  "responseTime": 83,
  "msg": "POST /v1/login 200"
}
```

- **`requestId`** — a UUID generated per request (or reused from an incoming `X-Request-Id` header, so it survives a call across services), also echoed back as the `X-Request-Id` response header for client-side correlation.
- **Level follows the response**: 2xx/3xx → `info`, 4xx → `warn` (so auth failures, validation errors, rate limits show up distinctly from normal traffic without being `error`), 5xx or an uncaught exception → `error`.
- Every error path — the central `errorHandler`, the best-effort cache read/write failures in `AuthService`/`UserService`, the `pg.Pool` idle-client error handler — goes through this same structured logger with an `err` field carrying the full error/stack, not `console.error`.
- `LOG_LEVEL` (env var, default `info`) controls verbosity. `npm run dev` pipes through `pino-pretty` for human-readable local output; `npm start`/Docker/CI get raw JSON, ready to ship to a log aggregator.
- `logger.ts` exports `createLogger`/`createHttpLogger` factories (not just the ready-to-use singletons) specifically so tests can inject an in-memory destination instead of writing real output — see `src/__tests__/unit/logger.test.ts`.

## Health checks

| Endpoint      | Purpose                                                | Checks                                                                      | Slow/unreachable dependency                                       |
| ------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /health` | Liveness — is the process itself up?                   | None                                                                        | N/A — always `200 { "status": "ok" }` if this handler runs at all |
| `GET /ready`  | Readiness — can this instance serve traffic right now? | PostgreSQL (`SELECT 1`) and Redis (`PING`), each raced against a 2s timeout | `503 { "postgres": "ok" \| "error", "redis": "ok" \| "error" }`   |

Keeping these separate matters: an orchestrator that conflates them will kill and restart a perfectly healthy process just because a downstream dependency is temporarily slow. The 2-second timeout on each `/ready` check exists because `ioredis` queues commands and waits for reconnection instead of rejecting promptly when Redis is unreachable (`enableOfflineQueue`) — a bare `redisClient.ping()` can hang far longer than a readiness probe should ever wait.

## Metrics

`GET /metrics` (`src/metrics.ts`) exposes [Prometheus](https://prometheus.io) text-format metrics via `prom-client`: the standard Node.js process/runtime metrics (`collectDefaultMetrics`) plus `http_request_duration_seconds`, a histogram labeled by `method`, `route`, and `status`. The `route` label is the matched Express pattern (e.g. `/users/profile/:id`), not the raw URL, so a path parameter like a UUID never fragments the metric into one series per request. No auth on the endpoint — same as `/health`/`/ready`, it's an infra/meta endpoint meant to be scraped from inside the deployment network, not exposed publicly.

## Graceful shutdown

`startServer()` (`src/server.ts`) handles `SIGTERM`/`SIGINT` by: stop accepting new connections (`server.close()`) → let in-flight requests finish → close the PostgreSQL pool (`pool.end()`) and quit Redis (`redisClient.quit()`) → exit `0`. A 10-second watchdog timer force-exits (`1`) if shutdown hasn't finished by then, so a stuck dependency can't hang a container forever. This is what lets Docker/Kubernetes stop or roll a container without dropping requests that were already in flight.

`pg.Pool` emits an `'error'` event on an idle client (e.g. the Postgres connection drops) independently of any in-flight query. Node's `EventEmitter` throws and **crashes the process** on an unhandled `'error'` event, so `src/postgres.ts` registers a listener that logs it instead — a Postgres blip surfaces as a degraded `/ready` response, not a crashed process.
