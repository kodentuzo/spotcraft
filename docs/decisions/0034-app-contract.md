---
title: Every app gets the same small contract, with no switches
number: 34
status: accepted
implementation: planned
date: 2026-11-19
supersedes: [15, 30]
superseded_by: []
notes: "Supersedes ADR 0015 (a database per app, opt-in) and the per-database dumps of ADR 0030. Wave 1 builds the instance database with a schema per app, the reserved env vars, migrations run by the server, and /_spotcraft/auth. Static apps, analytics, SMTP and the other defaults come in wave 2. To check while building: drizzle-kit with the app's schema on the search path."
---

# Every app gets the same small contract, with no switches

## Context

Spotcraft runs on a VPS its owner pays for, as a cheaper stand-in for Netlify and Railway. It
should also stay small, and apps should not depend on it: an app that leaves should only need
other env values.

Today every app is a container with options: `database: true` (ADR 0015), memory, CPUs, port,
read-only. Apps set platform values by hand (`AUTH_SECRET`, `PUBLIC_URL`), run their own
migrations when they start, and each wrote its own health check. Each app has its own database,
so nothing in it can point at users kept anywhere else. Every switch is something to choose,
document and test, and something that differs between apps.

## Decision

- **Spotcraft does:** containers, static files, one Postgres database for the instance with a
  schema per app, one user pool per instance ([ADR 0035](0035-auth-pool.md)), analytics, SMTP,
  HTTPS, DNS, metrics and backups.
- **Spotcraft does not:** build code, watch git, make preview environments, run functions, or
  serve more than one owner. CI builds; Spotcraft receives an image or a folder.
- **Portability:** an app sees only standards: a Postgres URL, a JWT checked against JWKS, an
  SMTP URL, a port, and paths under `/_spotcraft/`. The same app runs elsewhere with other values.
- **No switch for what every app should have.** Settings exist only where apps really differ:
  the name (slug), a custom domain, and the app's own env.
  - Every container app has a schema. Using it is up to the app. Static apps never have one.
  - Every container app is in the instance's user pool and gets its env vars. Using them is up
    to the app.
  - Platform secrets and URLs are generated, never typed in.
  - Health: the image's `HEALTHCHECK`; without one, `GET /health` must answer 200; without
    that, the port must accept connections.
- **One database per instance, `apps`, like a Supabase project:**
  - Each container app gets a schema and a role, both `app_<slug>` (dashes become underscores).
    The role owns the schema, has it as its `search_path`, may connect to `apps` and nothing
    more: it can't create schemas or extensions, or see other apps' schemas.
  - The `auth` schema belongs to the pool. Apps may read `auth.users` and reference it in
    foreign keys ([ADR 0035](0035-auth-pool.md)).
  - Each app role is limited to 20 connections and 30-second statements.
  - Extensions are the instance's: Spotcraft installs the ones apps need, for all of them.
- **The server runs migrations.** An image names its migration command in the label
  `dev.spotcraft.migrate`, as a JSON array (`["node", "migrate.js"]`). On every deploy, before
  starting the new version, the agent runs it once in a container from the new image, with the
  app's env, network and limits, for up to 5 minutes. If it fails, the deploy fails and the old
  version keeps serving. While it runs, the old version is still up, so migrations only add
  ([ADR 0028](0028-zero-downtime-deploys.md)). An image without the label migrates itself, or
  not at all.
- **Reserved env vars**, always set for container apps, which the app's own env can't override:
  `PORT`, `PUBLIC_URL`, `APP_NAME`, `APP_RELEASE`, `APP_SECRET`, `DATABASE_URL`,
  `DATABASE_SCHEMA`, `AUTH_URL`, `AUTH_ISSUER`, `AUTH_JWKS_URL`. `SMTP_URL` and `MAIL_FROM` join
  them when instance SMTP exists.
- **Reserved paths:** `/_spotcraft/*` on every app's domains belongs to the platform. Caddy
  proxies `/_spotcraft/auth/*` to the pool. `/_spotcraft/webhook` is kept for calls from the
  platform to the app, when one is needed.
- **What apps do themselves:** stop within 30 seconds of SIGTERM, and log JSON lines (`level`,
  `msg`, `time`) to stdout.
- **Backups** dump each app's schema (`pg_dump --schema=app_<slug>`) and the `auth` schema
  separately, with the rest of ADR 0030 unchanged. A restore puts back one app's schema as its
  own role.
- **`spotcraft.json`** in each deployable folder names the app (`name`, the slug) and may give a
  `migrate` command that `spotcraft dev` runs on the developer's machine. A monorepo has one per
  deployable.
- **Apps made before this record** keep their own database until they move into a schema.
- The details live in [docs/contracts.md](../contracts.md), which changes with this record.

## Consequences

- App tables can point at users with real foreign keys, and Postgres deletes an app's rows with
  their user. No app has to listen for deletions.
- An app that doesn't need a schema or users still gets them. An empty schema and a few env vars
  cost almost nothing.
- Apps share one database, so isolation rests on Postgres roles and grants instead of separate
  databases. One app's long query or lock can still slow the others; the limits keep that small.
- ORMs must keep their migration records in the app's schema. Drizzle's migrator defaults to a
  `drizzle` schema, which an app can't create, so its config sets `migrationsSchema` to
  `DATABASE_SCHEMA`.
- Fewer choices in the dashboard and the docs. Unusual needs (more memory, say) still work, but
  appear only when they come up.
- Apps can't use the names, labels or paths reserved here for their own purposes.
- Changing the contract is a breaking change for every app at once, so it changes rarely and
  with migration steps.
