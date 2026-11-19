---
title: The kit becomes spotkit, outside this repository
number: 36
status: accepted
implementation: planned
date: 2026-11-19
supersedes: [27, 31]
superseded_by: []
notes: "Wave 1: provisioning moves into a private workspace package; the CLI is published as @kodentuzo/spotcraft; spotkit 0.1 in kodentuzo/spotkit; @spotcraft/kit and the spotcraft npm package are deprecated. ADR 0032's rule for older apps on newer databases carries over to spotkit's migrate."
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

- **Provisioning moves into the platform:** `provision` and `purge` become a private workspace
  package used by the agent and the CLI. It is not published. It creates the role and the
  database only, without an `auth` schema. Existing `auth` schemas are left alone until their app
  drops them.
- **App helpers become `@kodentuzo/spotkit`,** in its own repository, `kodentuzo/spotkit`, with its
  own version. It uses Web `Request`, `Response` and `Headers` only, and has no framework
  adapters:
  - `verifyUser(request)` checks a bearer token or session JWT against `AUTH_JWKS_URL`;
  - `guest(request)` gets or creates the guest through `AUTH_URL`;
  - `verifyWebhook(request)` checks a platform webhook;
  - `clientAddress(headers)`, `health()`;
  - `migrate(migrations)` keeps ADR 0031's and ADR 0032's rules for an app's own migrations.
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
