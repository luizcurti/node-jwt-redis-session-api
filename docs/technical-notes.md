# Technical Notes

Toolchain and operations details that don't belong in the README.

## Node.js 24

Node 24 (Active LTS) is used everywhere: `engines`, CI's `setup-node`, and both Dockerfile stages. The base image is pinned by digest, and Dependabot bumps the digest but ignores Node majors — odd-numbered majors never become LTS, and changing the even major is a deliberate change to `engines`, CI and the Dockerfile together.

`@types/node` is a direct devDependency on the same major (`tsconfig.json` lists `"node"` in `types`); Dependabot ignores its majors for the same reason.

## TypeScript 6

The project uses TypeScript `~6.0` in strict mode. `ts-jest@29` accepts `typescript >=4.3 <7` and `typescript-eslint@8` accepts `<6.1.0`, so `tsc`, Jest and ESLint all run on the same compiler. Dependabot ignores TypeScript `>=6.1.0` until `typescript-eslint` supports it.

## ESLint

ESLint uses the `typescript-eslint` meta-package, which ships the parser and plugin as one version. `eslint-config-prettier` is applied last so no stylistic rule conflicts with Prettier; Prettier itself runs as a lint rule through `eslint-plugin-prettier`.

## `npm start` runs compiled JavaScript

`npm start` is `node dist/server.js`, so run `npm run build` first. `tsx` is a devDependency and is only used by `npm run dev`. The Docker image runs `node dist/server.js` directly.

## Metrics client

Metrics use `@prometheus-io/client`, the official Prometheus-org package (`prom-client` is deprecated in its favor and exposes the same API).

## The `jose` override

`package.json` overrides `jose` to `^4.15.9`. Nothing in the app uses `jose`; it's a transitive dependency of `newman` → `postman-runtime`, which pins `4.14.4`, a version with a known DoS advisory. The override stays within the same major.

## Dev-only audit findings

`npm audit` including devDependencies reports `@faker-js/faker` (high) and `csv-parse` (moderate), both pulled in by `newman` → `postman-collection`. `newman` 6.2.2 is the latest release, and overriding the two packages isn't safe: `postman-collection` calls faker 5 APIs (`phone.phoneNumberFormat`, `datatype.number`) that faker 10 doesn't have. Both are reachable only when Newman evaluates a collection or a CSV data file — here, only this repository's own collection, in CI. Neither ships in the Docker image, and the CI audit gate (`npm run audit`) runs with `--omit=dev`.

## Docker image

The runtime stage installs production dependencies and then deletes `npm`, `npx` and `corepack`: nothing in the container runs them (the app and the `migrate` service both start with `node`), and the npm CLI bundled in the base image carries its own dependency tree that would otherwise show up in image scans.

## Host ports in `docker-compose.yml`

PostgreSQL, Redis and the app publish on `127.0.0.1` only. The host ports are overridable with `APP_PORT`, `POSTGRES_HOST_PORT` and `REDIS_HOST_PORT` (defaults 3000, 5432, 6379), for when another project holds one of them. Inside the compose network the services always use the default ports.

## PostgreSQL data volume

The `pgdata` volume can only be opened by the PostgreSQL major version that created it (17). A volume created by a different major has to be removed (`docker compose down -v`) or upgraded with `pg_upgrade`.

## Scaling the app service

`app` has no `container_name`, so `docker compose up --scale app=N` starts N containers. A fixed host port can only be published once, so for N > 1 remove `ports:` from `app`, put a load balancer (nginx, Traefik) in front on the compose network, and set `TRUST_PROXY=1`. Sessions, rate limits and the login throttle all live in Redis, so they hold across replicas without further changes.
