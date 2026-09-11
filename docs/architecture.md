# Architecture — Implementation Details

## Layering

Controllers are thin: `asyncHandler` (`src/middleware/asyncHandler.ts`) wraps each `handle` method and forwards any rejected promise to the central `errorHandler` middleware via `next(error)`, so controllers never repeat try/catch boilerplate. All business rules (validation, password hashing, ownership checks, session lifecycle, caching) live in the service layer; repositories only wrap raw PostgreSQL/Redis calls.

Every collaborator — repositories, services, controllers, and the auth middleware (built by the `createAuthMiddleware` factory) — is constructed once in `src/routes.ts`, the single composition root, and injected via constructors. Nothing under `src/` reaches into a global singleton or instantiates its own dependencies.

Two Redis stores, two purposes: `CacheRepository` is a performance optimization (a denormalized read-through cache of the profile response), while `SessionRepository` is what authentication itself depends on. They're kept as separate classes on purpose rather than one grab-bag "Redis repository" — see the README's [Authentication Flow](../README.md#authentication-flow) section.

## Database schema

![Entity-relationship diagram](img/er-diagram.svg)

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CONSTRAINT users_role_check CHECK (role IN ('user', 'admin')),
  CONSTRAINT users_username_key UNIQUE (username),
  CONSTRAINT users_email_key UNIQUE (email)
);
```

(`migrations/..._create-users.sql` plus `migrations/..._add-role-to-users.sql` — the unique constraints are named explicitly rather than left to Postgres's auto-generated names, since `UserRepository.create` matches on them by name to translate a unique-violation into the right `ConflictError`.)

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
