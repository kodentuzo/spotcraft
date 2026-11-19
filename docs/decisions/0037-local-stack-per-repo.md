---
title: Each repository gets its own local stack
number: 37
status: accepted
implementation: planned
date: 2026-11-19
supersedes: [17]
superseded_by: []
notes: "Built: a Compose project per repository (root: the nearest .git or pnpm-workspace.yaml) with Postgres, the user pool from the Spotcraft image of the CLI's version (SPOTCRAFT_DEV_IMAGE overrides it) and Mailpit; ports and the pool's secret kept in .spotcraft/dev.json; spotcraft dev, env, db reset, migrate, status, stop, ls. Found while building: a local pool trusts any http://localhost:<port> origin (AUTH_LOCAL_ORIGINS), since dev servers run on any port. Not yet: CI using the same command instead of its Postgres service, and Umami (with analytics)."
---

# Each repository gets its own local stack

## Context

ADR 0017 runs one local Postgres for every app on a machine, so they share data and a reset of
one can affect another. Apps now also need the user pool ([ADR 0035](0035-auth-pool.md)) and,
later, email, so a database alone no longer matches what an app gets on the server.

## Decision

- **One stack per repository:** a Compose project `spotcraft-dev-<repo slug>` with Postgres (the
  version pinned for the server), the auth service with a `main` pool, and Mailpit to catch email.
  It has its own volume. Free ports are picked on first start and kept in `.spotcraft/dev.json`,
  which is not committed. All deployables in a monorepo share the stack.
- **Same as the server:** the `apps` database with the `auth` schema and a schema and role per
  app (`app_<slug>`), their limits and grants, the provisioning code, the reserved env var
  names, JWT claims and JWKS ([docs/contracts.md](../contracts.md)). In a monorepo, every
  deployable has its own schema in the one database, so their tables can point at the same
  users.
- **Commands:**
  - `spotcraft dev` starts the stack if needed, creates the app's schema, writes the missing
    reserved variables to `.env` (overwriting nothing), and runs the `migrate` command from
    `spotcraft.json`.
  - `spotcraft dev env` prints the variables.
  - `spotcraft dev db reset` recreates the app's schema after asking, then runs `migrate`.
  - `spotcraft dev status`, `stop` and `ls` (every stack on the machine).
- **CI uses the same command** before tests, instead of its own Postgres service.
- Still no Studio and no copying production data down.

## Consequences

- Repositories don't share local data, and CI runs what developers run.
- Several stacks running at once use more memory.
- The local pool only knows the repository's own users. Testing one account across apps from
  different repositories needs a staging instance.
