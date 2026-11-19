---
title: Every app gets the same small contract, with no switches
number: 34
status: accepted
implementation: planned
date: 2026-11-19
supersedes: [15]
superseded_by: []
notes: "Partly supersedes ADR 0015: a database is no longer opt-in. Wave 1 builds the database for every app, the reserved env vars, /_spotcraft/auth and the webhook. Static apps, analytics, SMTP and the other defaults come in wave 2."
---

# Every app gets the same small contract, with no switches

## Context

Spotcraft runs on a VPS its owner pays for, as a cheaper stand-in for Netlify and Railway. It
should also stay small, and apps should not depend on it: an app that leaves should only need
other env values.

Today every app is a container with options: `database: true` (ADR 0015), memory, CPUs, port,
read-only. Apps set platform values by hand (`AUTH_SECRET`, `PUBLIC_URL`). Each app wrote its own
health check, and the kit's guest accounts reached into the app's own database. Every switch is
something to choose, document and test, and something that differs between apps.

This record replaces ADR 0015's rule that an app asks for a database. The rest of ADR 0015 stands.

## Decision

- **Spotcraft does:** containers, static files, one Postgres with a database per app, one user
  pool per instance ([ADR 0035](0035-auth-pool.md)), analytics, SMTP, HTTPS, DNS, metrics and
  backups.
- **Spotcraft does not:** build code, watch git, make preview environments, run functions, or
  serve more than one owner. CI builds; Spotcraft receives an image or a folder.
- **Portability:** an app sees only standards: a Postgres URL, a JWT checked against JWKS, an
  SMTP URL, a port, and paths under `/_spotcraft/`. The same app runs elsewhere with other values.
- **No switch for what every app should have.** Settings exist only where apps really differ:
  the name (slug), a custom domain, and the app's own env.
  - Every container app has a database, `app_<slug>`. Using it is up to the app. Static apps
    never have one.
  - Every container app is in the instance's user pool and gets its env vars. Using them is up
    to the app.
  - Platform secrets and URLs are generated, never typed in.
  - Health: the image's `HEALTHCHECK`; without one, `GET /health` must answer 200; without
    that, the port must accept connections.
- **Reserved env vars**, always set for container apps, which the app's own env can't override:
  `PORT`, `PUBLIC_URL`, `APP_NAME`, `APP_RELEASE`, `APP_SECRET`, `DATABASE_URL`, `AUTH_URL`,
  `AUTH_ISSUER`, `AUTH_JWKS_URL`, `WEBHOOK_SECRET`. `SMTP_URL` and `MAIL_FROM` join them when
  instance SMTP exists.
- **Reserved paths:** `/_spotcraft/*` on every app's domains belongs to the platform. Caddy
  proxies `/_spotcraft/auth/*` to the pool. The app handles only `POST /_spotcraft/webhook`, the
  one signed call the platform makes to it; events differ by `type`, never by path.
- **What apps do themselves:** run their own migrations at start, under a lock, only adding
  ([ADR 0028](0028-zero-downtime-deploys.md)); stop within 30 seconds of SIGTERM; log JSON lines
  (`level`, `msg`, `time`) to stdout.
- **`spotcraft.json`** in each deployable folder names the app (`name`, the slug) and may give a
  `migrate` command for local development. A monorepo has one per deployable.
- The details live in [docs/contracts.md](../contracts.md), which changes with this record.

## Consequences

- An app that doesn't need a database or users still gets them. An idle Postgres database and a
  few env vars cost almost nothing.
- Fewer choices in the dashboard and the docs. Unusual needs (more memory, say) still work, but
  appear only when they come up.
- Apps can't use the names or paths reserved here for their own purposes.
- Changing the contract is a breaking change for every app at once, so it changes rarely and
  with migration steps.
