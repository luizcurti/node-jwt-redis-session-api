# Architecture — Implementation Details

## Layering

Controllers are thin: `asyncHandler` (`src/middleware/asyncHandler.ts`) wraps each `handle` method and forwards any rejected promise to the central `errorHandler` middleware via `next(error)`, so controllers never repeat try/catch boilerplate. All business rules (validation, password hashing, session lifecycle, login throttling, caching) live in the service layer; repositories only wrap raw PostgreSQL/Redis calls.

Every collaborator — repositories, services, controllers, rate limiters, and the auth middleware (built by the `createAuthMiddleware` factory) — is constructed in `createRouter()` in `src/routes.ts`, the single composition root, and injected via constructors. `createApp()` in `src/server.ts` builds the Express app around it and takes the rate-limit policy, `trust proxy` setting and metrics token as options, so tests can run the real middleware chain with their own limits instead of switching limiters off.

Three Redis touchpoints, three purposes: `CacheRepository` is a performance optimization (a denormalized read-through cache of the profile response), `SessionRepository` is what authentication itself depends on (sessions, the per-user session index, atomic rotation), and `LoginThrottle` holds the per-account failed-login backoff. They're separate classes rather than one grab-bag "Redis repository" because their failure handling differs — see [security.md](security.md#session-lifecycle).

## Database schema

![Entity-relationship diagram](img/er-diagram.svg)

The schema after all migrations, as one statement:

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CONSTRAINT users_role_check CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),          -- bumped by a BEFORE UPDATE trigger
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_key UNIQUE (email)
);
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));
```

Defined by three migrations in `migrations/`: `..._create-users.sql`, `..._add-role-to-users.sql`, and `..._harden-users.sql`.

- **Case-insensitive usernames** use a unique expression index rather than `citext`: the column stays plain `TEXT`, no extension is needed, and every lookup (`WHERE lower(username) = lower($1)`) is an index lookup on exactly that expression. Emails are lowercased before they're stored, so a plain unique constraint is enough there.
- **Named unique constraints/indexes**, not Postgres's auto-generated names: `UserRepository.create` matches on `users_username_lower_key` / `users_email_key` by name to translate a `23505` unique-violation into the right `ConflictError`.
- **Pagination** orders by `created_at, id` — a total order, since `id` is unique — so `LIMIT`/`OFFSET` pages never repeat or skip a row.

## Database migrations

Schema changes are plain SQL migration files under `migrations/`, run with [node-pg-migrate](https://github.com/salsita/node-pg-migrate) — no ORM, consistent with the rest of the project. Each file has an `-- Up Migration` and a `-- Down Migration` section; `node-pg-migrate` tracks which ones have run in a `pgmigrations` table.

| Command                         | Description                                             |
| -------------------------------- | -------------------------------------------------------- |
| `npm run migrate`               | Apply all pending migrations                            |
| `npm run migrate:down`          | Roll back the most recently applied migration           |
| `npm run migrate:create <name>` | Scaffold a new `migrations/<timestamp>_<name>.sql` file |

Migrations are applied the same way in every environment — there's exactly one path, not a dev-only shortcut and a separate "real" one:

- **Docker Compose**: a dedicated one-shot `migrate` service applies pending migrations and exits; the `app` service has `depends_on: migrate: condition: service_completed_successfully`, so it can't start against a schema that isn't there yet.
- **Local dev without Docker**: `npm run migrate` before `npm run dev`.
- **Tests**: the integration/e2e Jest projects' `globalSetup` runs the same migration runner programmatically before the suite starts (`src/__tests__/testSetup/globalSetup.js`) — tests run against a schema produced by the real migrations, not a separate fixture.
- **CI**: covered by the above — no separate migration step in `.github/workflows/ci.yml` is needed.
