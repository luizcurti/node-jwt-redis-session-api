# Technical Notes

Small implementation footnotes that don't belong in the main README but are worth writing down somewhere.

## Why TypeScript is pinned to 5.9.x

TypeScript 7 (the Go-based native compiler) and TypeScript 6 aren't supported by `@typescript-eslint` yet, and TS 6.0.3 has a regression where `@types/jest` globals (`describe`, `it`, `expect`, ...) stop resolving via `typeRoots`. `5.9.3` is the newest version compatible with the rest of the toolchain — revisit this pin once `@typescript-eslint` catches up.

## Why `docker-compose.override.yml` isn't committed

Local validation against this repo sometimes needs to remap a host port (e.g. another project already holds `5432`). That's an environment-specific concern, not a project default, so it's created ad hoc and deleted afterward rather than checked in. See [Quick Start](../README.md#quick-start) for the default port mapping.
