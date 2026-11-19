---
title: Each instance runs one user pool, starting with guests
number: 35
status: accepted
implementation: planned
date: 2026-11-19
supersedes: [16, 18]
superseded_by: []
notes: "Wave 1: the main pool with guests, bearer tokens and JWKS in the auth schema of the instance database; the route through each app's domain; the Pool page; moving sokobanko's and vinskiano's guests, sessions and tables. Sign-in, sign-out and turning a guest into a user come later. To check while building: Better Auth with a base URL and trusted origins that change per request."
---

# Each instance runs one user pool, starting with guests

## Context

ADR 0016 put guest accounts in a library, the kit, with an `auth` schema in each app's own
database. ADR 0018 let the dashboard read and delete those rows. Since then:

- An owner's apps belong together (LibreLifts and LibreBars, say), and a person should have one
  account across them, as in a Supabase project.
- The LibreLifts and LibreBars APIs, client-side apps with Expo clients, run their own Better
  Auth. The kit could not serve them, because it is for server-rendered apps only.
- Every app database had its own copy of the `auth` tables, migrated by the platform.

Apps now share one instance database with a schema each ([ADR 0034](0034-app-contract.md)).
This record replaces ADRs 0016 and 0018.

## Decision

- **One pool per instance, called `main`,** served by a small auth service in Spotcraft's image
  (ADR 0025 pattern): Fastify with Better Auth. The pool's name appears in its paths and key ids,
  so more pools can be added later without breaking anything.
- **Storage: the `auth` schema** of the instance database, owned by the auth service's role,
  `spotcraft_auth`, which also runs its migrations. Apps (the `spotcraft_app` role every app
  role belongs to) may `SELECT` and `REFERENCES` `auth.users`, and nothing else in `auth`.
  Backups dump it on its own.
- **For now, users are guests.** Better Auth plugins: `anonymous`, `bearer` (for clients without
  cookies) and `jwt` (short-lived tokens and a JWKS). Ids are UUIDs.
- **Two ways to reach the pool:**
  - On every app's domain, Caddy proxies `/_spotcraft/auth/*` to the pool. Cookies stay
    first-party on the app's domain, and there's no CORS. `AUTH_URL` is this address.
  - `https://auth.<instance domain>/main` is for clients without such a domain (Expo apps, sites
    not on Spotcraft yet). It uses bearer tokens, and CORS allows the instance's app domains plus
    a list of extra origins in the instance's settings.
- **Apps trust a JWT.** Claims: `iss` (the pool), `sub` (the user id), `is_anonymous`, `iat`,
  `exp`. Apps check the signature against `AUTH_JWKS_URL` and the issuer against
  `AUTH_ISSUER`.
- **App tables reference users** with
  `user_id uuid references auth.users (id) on delete cascade` (or `set null`), as in Supabase.
  Deleting a user deletes their rows in every app. A foreign key that would block the delete
  (`restrict`, `no action`) is a bug in that app: the delete fails and the dashboard says which
  table blocked it.
- **Limits:** a cap on new guests per client address (Better Auth's rate limit, with the address
  from Caddy's X-Forwarded-For, [ADR 0031](0031-kit-app-glue.md)). Guests unused for 180 days are
  deleted (an instance setting).
- **The dashboard has a Pool page:** guest count, users, delete. The per-app Users tab and the
  agent's `/apps/:name/users` routes go away.
- **Moving the existing guests:** the kit's `auth` tables already follow Better Auth's model. A
  one-time move copies an app's users and sessions into the pool with the same ids and tokens,
  and its own tables into its schema, with their foreign keys pointing at the pool's
  `auth.users`. The pool uses the kit's cookie name, so a guest keeps their cookie and their
  data. The app's old database is then dropped.

## Consequences

- One account across an owner's apps, and client-side and mobile apps can have users too.
- No deletion events to deliver, retry or handle: the database keeps app data consistent with
  the pool.
- Apps can read every user of the instance, not only their own. For guests that is an id and
  timestamps; when sign-in adds emails, the columns apps may read get decided again.
- The auth service is shared: when it's down, apps can't create guests or refresh tokens. Apps
  that only verify JWTs keep working until the tokens expire.
- Guests in one app are not guests in another: each app creates its own until sign-in links
  them to one account, which a later record decides.
