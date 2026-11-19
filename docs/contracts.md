# The app contract

> **Planned.** This is the contract decided in ADRs
> [0034](decisions/0034-app-contract.md), [0035](decisions/0035-auth-pool.md),
> [0036](decisions/0036-spotkit.md) and [0037](decisions/0037-local-stack-per-repo.md). It is
> being built; until then, apps work as described in the guides.

Everything an app gets from Spotcraft, and everything Spotcraft expects from it. An app that
follows this page runs anywhere that provides the same values: a Supabase project, say, has the
same `auth.users` to point at.

## `spotcraft.json`

One per deployable folder, next to its `package.json` or `Dockerfile`:

```json
{ "name": "lifts-api", "migrate": "pnpm db:migrate" }
```

- `name` is the app's slug: lowercase letters, digits and dashes. It names the app's schema and
  role (`app_<slug>`, with dashes as underscores) and its subdomain. It is the app's identity:
  renaming means a new app.
- `migrate` is optional. `spotcraft dev` runs it on your machine after creating the schema. On
  the server, the image's label does that job (below).

## Environment variables

Spotcraft sets these for every container app. The app's own env can't override them.

| Variable          | Value                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| `PORT`            | The port to listen on.                                                     |
| `PUBLIC_URL`      | The app's public address, e.g. `https://librelifts.app`.                   |
| `APP_NAME`        | The slug.                                                                  |
| `APP_RELEASE`     | The image tag that is running.                                             |
| `APP_SECRET`      | 32 random bytes, base64, for the app's own signing. Stable across deploys. |
| `DATABASE_URL`    | The instance database, as the app's role.                                  |
| `DATABASE_SCHEMA` | The app's schema, `app_<slug>`.                                            |
| `AUTH_URL`        | The user pool, through the app's domain: `<PUBLIC_URL>/_spotcraft/auth`.   |
| `AUTH_ISSUER`     | The `iss` every token from the pool carries.                               |
| `AUTH_JWKS_URL`   | The pool's public keys.                                                    |
| `SMTP_URL`        | Coming with instance SMTP: `smtp://user:pass@host:587`.                    |
| `MAIL_FROM`       | Coming with instance SMTP: the sender address.                             |

Locally, `spotcraft dev` writes the same names to `.env`.

## Database

One Postgres database per instance, `apps`, laid out like a Supabase project:

| Schema       | Owner          | The app may                                    |
| ------------ | -------------- | ---------------------------------------------- |
| `app_<slug>` | the app's role | do anything: it is the app's own               |
| `auth`       | the user pool  | read `auth.users` and point foreign keys at it |
| other apps'  | their roles    | nothing                                        |

- The app's role has its schema as its `search_path`, so unqualified names (Drizzle's
  `pgTable`) land there.
- It can't create schemas or extensions. Ask for an extension to be added to the instance.
- At most 20 connections, and statements stop after 30 seconds.

With Drizzle:

```ts
import { pgSchema, pgTable, text, uuid } from 'drizzle-orm/pg-core'

// The pool's table: referenced, never migrated by the app.
export const users = pgSchema('auth').table('users', { id: uuid('id').primaryKey() })

export const workouts = pgTable('workouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
})
```

In `drizzle.config.ts`, keep the migrator inside the app's schema and away from `auth`:

```ts
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  schemaFilter: [process.env.DATABASE_SCHEMA ?? 'public'],
  migrations: { schema: process.env.DATABASE_SCHEMA },
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

## Migrations

The server runs them, before the new version starts:

```dockerfile
LABEL dev.spotcraft.migrate='["node", "dist/migrate.js"]'
```

- The label is a JSON array: the command and its arguments, run without a shell.
- It runs once per deploy, in a container from the new image, with the app's env and limits.
  Exit 0 to go on; anything else fails the deploy, and the running version keeps serving. It has
  5 minutes.
- The running version is still up while it runs, so migrations only add: new tables, new
  nullable columns. Renames and drops need two releases.
- Without the label, nothing runs; the app may migrate itself when it starts.

## Paths

`/_spotcraft/*` on every app domain belongs to the platform:

| Path                 | What                               |
| -------------------- | ---------------------------------- |
| `/_spotcraft/auth/*` | The user pool (Better Auth's API). |

Analytics will add `/_spotcraft/s.js` and `/_spotcraft/e`. `/_spotcraft/webhook` is kept for
calls from the platform to the app.

## Users

Users come from the instance's pool. Today they are all guests.

- **In the browser,** the app's page calls `AUTH_URL` (same origin, cookies). Better Auth's
  client with the anonymous plugin works as it is.
- **Without the app's domain** (an Expo app, a site not on Spotcraft yet), clients call
  `https://auth.<instance domain>/main` and send `Authorization: Bearer <token>`.
- **On the server,** the app asks the pool for a JWT for the session, or takes the bearer token,
  and checks it:
  - signed by a key from `AUTH_JWKS_URL` (EdDSA);
  - `iss` equals `AUTH_ISSUER`;
  - not expired.
- **Claims:** `sub` (the user id, a UUID, the same as `auth.users.id`), `is_anonymous`, `iss`,
  `iat`, `exp`.
- **App data** points at the user with a foreign key, `on delete cascade` or `on delete set
  null`. Deleting a user deletes their rows in every app. A key that blocks the delete is a bug.

## What the app does

- **Health:** a `HEALTHCHECK` in the image, or `GET /health` answering 200 when ready.
- **Stop:** finish within 30 seconds of SIGTERM.
- **Logs:** to stdout, ideally JSON lines with `level`, `msg` and `time`.
