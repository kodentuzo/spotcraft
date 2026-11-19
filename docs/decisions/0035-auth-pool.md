---
title: Each instance runs one user pool, starting with guests
number: 35
status: accepted
implementation: planned
date: 2026-11-19
supersedes: [16, 18]
superseded_by: []
notes: "Wave 1: the main pool with guests, bearer tokens and JWKS; the route through each app's domain; the user.deleted webhook; the Pool page; importing sokobanko's and vinskiano's guests and sessions. Sign-in, sign-out and turning a guest into a user come later. To check while building: Better Auth with a base URL and trusted origins that change per request."
---

# Each instance runs one user pool, starting with guests

## Context

ADR 0016 put guest accounts in a library, the kit, with an `auth` schema in each app's own
database. ADR 0018 let the dashboard read and delete those rows. Since then:

- An owner's apps belong together (LibreLifts and LibreBars, say), and a person should have one
  account across them, as in a Supabase project.
- The LibreLifts and LibreBars APIs, which are client-side apps with Expo clients, run their own
  Better Auth. The kit could not serve them, because it is for server-rendered apps only.
- The platform reads tables inside app databases, so app migrations and the platform are tied
  together.

This record replaces ADRs 0016 and 0018.

## Decision

- **One pool per instance, called `main`,** served by a small auth service in Spotcraft's image
  (ADR 0025 pattern): Fastify with Better Auth. The pool's name appears in its paths, its schema
  and its key ids, so more pools can be added later without breaking anything.
- **Storage:** the `auth` database in the shared Postgres, schema `pool_main`, with its own role.
  The nightly backup includes it ([ADR 0030](0030-backups.md)). Apps can't connect to it.
- **For now, users are guests.** Better Auth plugins: `anonymous`, `bearer` (for clients without
  cookies) and `jwt` (short-lived tokens and a JWKS). Ids are UUIDs.
- **Two ways to reach the pool:**
  - On every app's domain, Caddy proxies `/_spotcraft/auth/*` to the pool. Cookies stay
    first-party on the app's domain, and there's no CORS. `AUTH_URL` is this address.
  - `https://auth.<instance domain>/main` is for clients without such a domain (Expo apps, sites
    not on Spotcraft yet). It uses bearer tokens, and CORS allows the instance's app domains plus
    a list of extra origins in the instance's settings.
- **Apps trust a JWT, not a database.** Claims: `iss` (the pool), `sub` (the user id),
  `is_anonymous`, `iat`, `exp`. Apps check the signature against `AUTH_JWKS_URL` and the
  issuer against `AUTH_ISSUER`.
- **App data references users by `sub`,** as `user_id uuid` in the app's own tables, with no
  foreign key across databases.
- **Deleting a user** sends `POST /_spotcraft/webhook` with `{ "type": "user.deleted", "sub" }`
  to every app in the pool. It is signed with HMAC-SHA256 over the body, using the app's
  `WEBHOOK_SECRET`, with a timestamp, and retried with backoff. Each app deletes its own rows.
- **Limits:** a cap on new guests per client address (Better Auth's rate limit, with the address
  from Caddy's X-Forwarded-For, [ADR 0031](0031-kit-app-glue.md)). Guests unused for 180 days are
  deleted (an instance setting), with the same webhook.
- **The dashboard has a Pool page:** guest count, users, delete. The per-app Users tab and the
  agent's `/apps/:name/users` routes go away.
- **Moving the existing guests:** the kit's `auth` tables already follow Better Auth's model.
  A one-time import copies an app's users and sessions into `pool_main` with the same ids and
  tokens, and the pool uses the kit's cookie name, so a guest keeps their cookie and their data.
  The app then drops its foreign keys to `auth.users` and, after a check, its `auth` schema.

## Consequences

- One account across an owner's apps, and client-side and mobile apps can have users too.
- The platform knows users only through its own service. App databases are the apps' alone.
- The auth service is shared: when it's down, apps can't create guests or refresh tokens. Apps
  that only verify JWTs keep working until the tokens expire.
- Without foreign keys, an app that misses a webhook keeps rows for a deleted user until the
  retry lands. Apps must treat the webhook as repeatable.
- Guests in one app are not guests in another: each app creates its own until sign-in links
  them to one account, which a later record decides.
