# Configuration

| Variable             | Required             | Default     | Purpose                                                                                |
| -------------------- | -------------------- | ----------- | -------------------------------------------------------------------------------------- |
| `JWT_SECRET`         | yes                  | —           | HS256 signing key, at least 32 characters                                              |
| `POSTGRES_PASSWORD`  | yes (Compose)        | —           | PostgreSQL password                                                                    |
| `REDIS_PASSWORD`     | yes (Compose)        | —           | Redis `requirepass`                                                                    |
| `METRICS_TOKEN`      | recommended          | —           | Bearer token for `/metrics`; unset means open in development and `404` in production |
| `TRUST_PROXY`        | behind a proxy       | `false`     | Proxy hops (`1`) or subnets to trust for `X-Forwarded-For`; `true` is refused          |
| `PORT`               | no                   | `3000`      | HTTP port inside the container or process                                              |
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_USER` / `POSTGRES_DB` | no | `localhost` / `5432` / `user` / `mydb` | PostgreSQL connection |
| `REDIS_HOST` / `REDIS_PORT` | no            | `localhost` / `6379` | Redis connection                                                              |
| `LOG_LEVEL`          | no                   | `info`      | pino log level                                                                         |
| `APP_PORT` / `POSTGRES_HOST_PORT` / `REDIS_HOST_PORT` | no | `3000` / `5432` / `6379` | Host ports published by Compose (bound to `127.0.0.1`) |

`.env.example` lists them with placeholders. `docker compose up` refuses to start while `JWT_SECRET`, `POSTGRES_PASSWORD` or `REDIS_PASSWORD` is unset; generate values with `openssl rand -base64 48`.

The app reads `.env` through `dotenv`, so the same file works for `npm run dev` / `npm start` outside Docker.
