---
title: The kit becomes spotkit, outside this repository
number: 36
status: accepted
implementation: planned
date: 2026-11-19
supersedes: [27, 31]
superseded_by: []
notes: "Built: provisioning in the CLI package (spotcraft/provision), a schema per app in the apps database, legacy per-app databases kept; the agent no longer ships the kit, and a release no longer checks that the kit is published. The CLI is renamed @kodentuzo/spotcraft (export @kodentuzo/spotcraft/provision); its first publish and deprecating the old spotcraft package on npm are left to the release. To build in wave 1: spotkit 0.1 in kodentuzo/spotkit; @spotcraft/kit and the spotcraft npm package deprecated."
---

# The kit becomes spotkit, outside this repository

## Context

`@spotcraft/kit` does two jobs. For the platform, it provisions app databases and their `auth`
schema (used by the agent and the CLI). For apps, it does guest accounts, migrations, health,
the client address, and has adapters for Nuxt and TanStack Start (ADR 0031). Because of the first
job, it shares a release process with the platform (ADR 0027), and the platform and every app
depend on the same package.

With a user pool per instance ([ADR 0035](0035-auth-pool.md)), apps no longer need auth in
their database, and the remaining app helpers have nothing to do with Spotcraft's internals.

## Decision

- **Provisioning moves into the platform:** `provision` and `purge` live in the CLI package, as
  its `spotcraft/provision` export, and the agent imports them from there. They can't be a
  private package, because the published CLI needs them. The export is for Spotcraft only, not
  for apps. They create an app's role and schema in the instance database
  ([ADR 0034](0034-app-contract.md)), nothing else.
- **App helpers become `@kodentuzo/spotkit`,** in its own repository, `kodentuzo/spotkit`, with its
  own version. It uses Web `Request`, `Response` and `Headers` only, and has no framework
  adapters:
  - `verifyUser(request)` checks a bearer token or session JWT against `AUTH_JWKS_URL`;
  - `guest(request)` gets or creates the guest through `AUTH_URL`;
  - `clientAddress(headers)`, `health()`.
- **No migration runner.** The server runs an app's migrations with the app's own tool, such as
  Drizzle's migrator ([ADR 0034](0034-app-contract.md)), so the kit's `migrateApp` (ADRs 0031
  and 0032) isn't carried over.
- **spotkit is optional.** Everything it does is in [docs/contracts.md](../contracts.md), so an app
  can do it by hand or in another language.
- **The CLI is published as `@kodentuzo/spotcraft`** (the command stays `spotcraft`), with the
  project's version (ADR 0019).
- **`@spotcraft/kit` and the `spotcraft` package are deprecated** on npm, pointing to their
  replacements. They are not removed.

## Consequences

- One tag releases Spotcraft again. The kit's separate tags and release check go away.
- spotkit can change without a Spotcraft release, and a Spotcraft release never forces an app
  upgrade. The contract between them is [docs/contracts.md](../contracts.md), not a shared
  package.
- Nuxt and TanStack Start apps write a few lines of glue themselves, which the adapters used to
  hold.
- sokobanko and vinskiano switch packages once.
