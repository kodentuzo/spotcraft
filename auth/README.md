# @spotcraft/auth

The instance's user pool, `main` ([ADR 0035](../docs/decisions/0035-auth-pool.md)): one set of
users for every app on a Spotcraft server, as in a Supabase project. For now every user is a
guest. It is [Better Auth](https://www.better-auth.com) behind Node's own HTTP server, running
from the Spotcraft image as the `auth` service.

## What it serves

| Path                      | What                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `/_spotcraft/auth/*`      | Better Auth's API: `sign-in/anonymous`, `get-session`, `sign-out`, `token`, `jwks`, … |
| `/_spotcraft/auth/export` | `GET`: everything the pool holds about the signed-in user, as a JSON download         |
| `/health`                 | 200 once the `auth` schema is migrated and Postgres answers                           |

Caddy will route `/_spotcraft/auth/*` on every app's domain here. Nothing routes to it yet.

- **One Better Auth per host.** A request's `Host` (passed on by Caddy) is its base URL, so the
  session cookie is first-party on the app's own domain, and the origin check only accepts that
  origin. Hosts are made the first time they are seen. They share the database, so users,
  sessions and signing keys are the same on every domain. A dynamic base URL with wildcard
  hosts would also trust every origin those wildcards match.
- **Cookies:** `__Secure-better-auth.session_token`, `HttpOnly`, `SameSite=Lax`, path `/`, for a
  year, renewed daily on use.
- **Bearer tokens:** a sign-in also answers with `set-auth-token`. Clients on another origin
  (Expo, sites not on Spotcraft) send it as `Authorization: Bearer …`. They get CORS only if
  their origin is in `AUTH_TRUSTED_ORIGINS`.
- **JWTs:** `GET /_spotcraft/auth/token` returns a 15-minute EdDSA token with `iss`
  (`AUTH_ISSUER`), `sub` (the user id), `is_anonymous`, `iat` and `exp`. Apps check it against
  `/_spotcraft/auth/jwks`.
- **New guests are limited** to 30 per client address per 10 minutes, per host. The address is
  `X-Spotcraft-Client-IP`, which Caddy sets to the address it resolved, replacing anything the
  client sent. An IPv6 address counts as its /64.
- **Guests moved in from the kit keep their cookies.** An app that kept its own guests with
  `@spotcraft/kit` signed their session cookies with its own `AUTH_SECRET`. When the agent
  moves it, the guests and sessions come with the same tokens and the secret goes into
  `auth.former_secrets`. A session cookie signed with one of those is re-signed with the pool's
  secret before Better Auth reads it, and the browser gets the re-signed cookie. The list is
  read again at most once a minute.
- **The origin and CSRF checks are on explicitly.** Better Auth turns them off when it sees a
  test runner, so the tests would otherwise pass without them.

## Database

It connects to the instance database, `apps`, as `spotcraft_auth`, which owns the `auth`
schema. The deploy script creates that role, the schema and the `spotcraft_app` group. At
start, the service:

1. applies `src/migrations/*.sql` in one transaction under an advisory lock, recorded in
   `auth.migrations`. Migrations only add. A database newer than the service stops it.
2. grants `spotcraft_app` (every app role belongs to it) `USAGE` on `auth`, `SELECT` on
   `auth.users (id, is_anonymous, created_at, updated_at)` and `REFERENCES (id)`. Apps can't
   read emails, sessions, accounts or keys.
3. grants the agent's role (`AUTH_ADMIN_ROLE`, default `spotcraft_agent`), if it exists,
   `SELECT` on `auth.users` and `auth.sessions` and `DELETE` on `auth.users`, for the
   dashboard's Users page, and `INSERT` on `auth.users`, `auth.sessions` and
   `auth.former_secrets`, for moving an app's guests in.

Postgres may still be starting, so it retries every 5 seconds for 3 minutes; `/health` answers
503 until then.

Tables: `users`, `sessions`, `accounts`, `verifications` (Better Auth's), `jwks` (signing
keys, private keys encrypted with `AUTH_SECRET`), `former_secrets` (moved apps' old secrets) and
`deletions` (deleted users' ids). Plural snake_case names, `uuid` ids,
`timestamptz` times. `src/schema.ts` mirrors Better Auth's for its Drizzle adapter, and a test
checks the two agree.

Each session also records the host it was made or last renewed on (`host`) and the client's
`Spotcraft-Client: <platform>/<version>` header (`client`; anything else is ignored), set by
Better Auth's session hooks. Renewals happen at most once a day. The agent counts an app's
accounts from these ([ADR 0038](../docs/decisions/0038-analytics.md)); CORS allows the header
for bearer clients.

## Data rights and retention

[ADR 0043](../docs/decisions/0043-apps-own-their-ui.md).

- **A guest deletes themselves** with `POST /_spotcraft/auth/delete-anonymous-user` (Better
  Auth's anonymous plugin, with the origin check). Their sessions go first, then the user, and
  their rows in apps go with them through the apps' `on delete cascade` keys. If an app's key
  blocks it, the request fails with 500 and the error, naming the table, is logged.
- **Export:** `GET /_spotcraft/auth/export` answers the user, their sessions (times, IP address,
  user agent, host, client) and their accounts, as `account.json`. Session tokens, password
  hashes and OAuth tokens are left out. Apps export their own rows.
- **Every deletion is logged** in `auth.deletions`, the user's id and the time only, by a trigger
  on `auth.users`. So a guest deleting themselves, the dashboard and the cleanup below all
  count. It is kept for `AUTH_BACKUP_DAYS`, as long as backups, so a restore can delete those
  users again. The agent's role can delete users but not read or change the log.
- **Once a day:**
  - guests created and unused for `AUTH_GUEST_DAYS` are deleted, one at a time. A guest an
    app's key blocks is skipped and logged;
  - expired sessions are deleted;
  - the IP address and user agent of sessions unused for `AUTH_IP_DAYS` are cleared;
  - deletion records older than `AUTH_BACKUP_DAYS` are deleted.

## Settings

| Variable               | What                                                               |
| ---------------------- | ------------------------------------------------------------------ |
| `AUTH_DATABASE_URL`    | `spotcraft_auth` on the `apps` database                            |
| `AUTH_SECRET`          | at least 32 characters; signs sessions, encrypts keys              |
| `AUTH_ISSUER`          | every token's `iss`, e.g. `https://dash.example.com/pools/main`    |
| `AUTH_TRUSTED_ORIGINS` | optional, comma-separated origins of bearer clients on other sites |
| `AUTH_PROTOCOL`        | `https` (default), or `http` for a local stack                     |
| `AUTH_LOCAL_ORIGINS`   | `1` only in a local stack: trust any `http://localhost:<port>`     |
| `AUTH_APP_GROUP`       | the app group, default `spotcraft_app`                             |
| `AUTH_ADMIN_ROLE`      | the agent's role, default `spotcraft_agent`                        |
| `AUTH_GUEST_DAYS`      | idle guests are deleted after this many days, default 180          |
| `AUTH_IP_DAYS`         | sessions' IP address and user agent are cleared after, default 30  |
| `AUTH_BACKUP_DAYS`     | deleted users' ids are kept this long, like backups; default 30    |
| `PORT`, `HOST`         | default `3000`, `0.0.0.0`                                          |

On the server, the deploy script generates `AUTH_SECRET` and the role's password on the first
deploy and keeps them in `.env`. Changing `AUTH_SECRET` signs every guest out.

## Developing

```bash
pnpm --filter @spotcraft/auth test   # database tests need KIT_TEST_POSTGRES_URL (a throwaway superuser URL)
```

The tests make their own database, roles and schema, and send requests with the `Host` and
client address headers Caddy would.
