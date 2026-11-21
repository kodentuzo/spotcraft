# The app contract

> **Mostly built.** This is the contract decided in ADRs
> [0034](decisions/0034-app-contract.md), [0035](decisions/0035-auth-pool.md),
> [0036](decisions/0036-spotkit.md) and [0037](decisions/0037-local-stack-per-repo.md). Built: a
> schema per app, the environment Spotcraft sets, migrations from the image's label, the health
> check, the user pool with guests, analytics and the [local stack](guides/local-stack.md). Not
> yet: static apps, SMTP, signing in and turning a guest into a user, and spotkit on npm.

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
| `LEGAL_FACTS`     | The instance's legal facts, as JSON (below).                               |

Locally, `spotcraft dev` writes the same names to `.env`, pointing at the repository's own stack
([the CLI](../packages/cli/README.md)).

## Database

One Postgres database per instance, `apps`, laid out like a Supabase project:

| Schema       | Owner          | The app may                                                                                             |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------- |
| `app_<slug>` | the app's role | do anything: it is the app's own                                                                        |
| `auth`       | the user pool  | read `auth.users` (`id`, `is_anonymous`, `created_at`, `updated_at`) and point foreign keys at its `id` |
| other apps'  | their roles    | nothing                                                                                                 |

- The app's role has its schema as its `search_path`, so unqualified names (Drizzle's
  `pgTable`) land there.
- It can't create schemas or extensions. Ask for an extension to be added to the instance.
- At most 20 connections, and statements stop after 30 seconds.

With Drizzle, put the app's tables in its schema by name, and keep the pool's `users` table in a
file of its own that the config doesn't list, so drizzle-kit only references it:

```ts
// src/db/auth.ts: the pool's table, referenced, never migrated by the app.
import { pgSchema, uuid } from 'drizzle-orm/pg-core'

export const users = pgSchema('auth').table('users', { id: uuid('id').primaryKey() })
```

```ts
// src/db/schema.ts: the app's tables.
import { pgSchema, text, uuid } from 'drizzle-orm/pg-core'
import { users } from './auth.ts'

// The app's schema, app_<slug>: the same name on the server and locally. Not exported, so
// drizzle-kit doesn't try to create it.
const app = pgSchema('app_lifts')

export const workouts = app.table('workouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
})
```

A plain `pgTable` would work for queries, but drizzle-kit writes `"public"."<table>"` into the
foreign keys between the app's own tables, and an app can't use `public`.

In `drizzle.config.ts`, list only the app's tables:

```ts
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
})
```

Drizzle's `migrate()` and `drizzle-kit migrate` can't apply the files on Spotcraft: they first
run `CREATE SCHEMA IF NOT EXISTS` for their journal, and Postgres checks the right to create
schemas before it notices that the schema exists. Apply them with a few lines instead, in
Drizzle's own journal table, so drizzle-kit keeps working as before:

```ts
// src/db/migrate.ts: `node src/db/migrate.ts`, or the image's migrate label.
import { readMigrationFiles } from 'drizzle-orm/migrator'
import pg from 'pg'

const schema = process.env.DATABASE_SCHEMA ?? 'app_lifts'
const journal = `${pg.escapeIdentifier(schema)}.__drizzle_migrations`
const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
try {
  await client.query('BEGIN')
  await client.query('SELECT pg_advisory_xact_lock(1)')
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${journal} (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  )
  const { rows } = await client.query(`SELECT max(created_at) AS last FROM ${journal}`)
  const last = Number(rows[0].last ?? 0)
  for (const migration of readMigrationFiles({ migrationsFolder: './drizzle' })) {
    if (migration.folderMillis <= last) continue
    for (const statement of migration.sql) await client.query(statement)
    await client.query(`INSERT INTO ${journal} (hash, created_at) VALUES ($1, $2)`, [
      migration.hash,
      migration.folderMillis,
    ])
  }
  await client.query('COMMIT')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
```

## Migrations

The server runs them, before the new version starts:

```dockerfile
LABEL dev.spotcraft.migrate='["node", "dist/migrate.js"]'
# in a distroless image, where node isn't on the PATH:
LABEL dev.spotcraft.migrate='["/nodejs/bin/node", "dist/migrate.js"]'
```

- The label is a JSON array: the command and its arguments, run without a shell. It replaces
  the image's entrypoint and command.
- It runs once per deploy, in a container from the new image, with the app's env and limits.
  Exit 0 to go on; anything else fails the deploy, and the running version keeps serving. It has
  5 minutes.
- The running version is still up while it runs, so migrations only add: new tables, new
  nullable columns. Renames and drops need two releases.
- Without the label, nothing runs; the app may migrate itself when it starts.

## Paths

`/_spotcraft/*` on every app domain belongs to the platform:

| Path                      | What                                                                  |
| ------------------------- | --------------------------------------------------------------------- |
| `/_spotcraft/auth/*`      | The user pool (Better Auth's API).                                    |
| `/_spotcraft/s.js`        | The analytics script (Umami's tracker).                               |
| `/_spotcraft/e`           | Where analytics events go (Umami's collect endpoint).                 |
| `/_spotcraft/config.json` | The app's analytics settings, for clients that send their own events. |
| `/_spotcraft/privacy`     | What Spotcraft counts for the app, and how to opt out.                |
| `/_spotcraft/legal.json`  | The instance's legal facts, the same as `LEGAL_FACTS`.                |

`/_spotcraft/webhook` is kept for calls from the platform to the app.

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
  `iat`, `exp`. Tokens last 15 minutes. `GET <AUTH_URL>/token` returns one for the session or
  bearer token it is sent.
- **App data** points at the user with a foreign key, `on delete cascade` or `on delete set
  null`. Deleting a user deletes their rows in every app. A key that blocks the delete is a bug.
- **Deleting and exporting** ([ADR 0043](decisions/0043-apps-own-their-ui.md)):
  - a guest deletes themselves with `POST <AUTH_URL>/delete-anonymous-user` (same origin, with
    their session). Their rows in every app go with them, so an app needs no delete code;
  - `GET <AUTH_URL>/export` answers what the pool holds about the signed-in user, as JSON. The
    app exports its own rows, and offers both.
- **What the pool keeps:** expired sessions are deleted daily; a session's IP address and user
  agent are cleared after 30 days unused; guests unused for 180 days are deleted. Deleted
  users' ids are kept 30 days, as long as backups, so a restore can delete them again.
- **Logs:** Spotcraft keeps no access logs. An app that logs a client's IP address keeps it no
  longer than 30 days, and says so in its privacy page.

## Legal facts

Who runs the instance and what it does with personal data, as data
([ADR 0043](decisions/0043-apps-own-their-ui.md)), for an app's privacy policy and legal notice.
The owner sets their details once on the dashboard's Settings page; nothing goes into the app's
repository. A server reads `LEGAL_FACTS`; a client without one reads
`<app URL>/_spotcraft/legal.json`.

```json
{
  "version": 1,
  "updated": "2026-11-21",
  "controller": {
    "name": "…",
    "address": ["…", "…"],
    "email": "privacy@…",
    "authority": { "name": "…", "url": "https://…" }
  },
  "processing": [
    {
      "id": "hosting",
      "basis": "contract",
      "retentionDays": null,
      "processor": { "name": "Hetzner Online GmbH", "country": "DE" }
    },
    {
      "id": "edge",
      "basis": "legitimate-interests",
      "retentionDays": null,
      "processor": { "name": "Cloudflare, Inc.", "country": "US" },
      "transfer": { "country": "US", "basis": "dpf" }
    },
    { "id": "accounts", "basis": "contract", "retentionDays": 180 },
    { "id": "sessions", "basis": "legitimate-interests", "retentionDays": 30 }
  ]
}
```

- `updated` is when any fact last changed: the policy's "last changed" date.
- `controller` is null until the owner fills in their details.
- `processing` lists only what the instance does. Each `id` says what data and why:
  `hosting` (everything the app stores and serves), `edge` (requests pass through Cloudflare),
  `accounts` (the pool's accounts and their data in apps), `sessions` (IP address and user
  agent, against abuse), `backups` (nightly copies) and `analytics` (counts without cookies or
  ids). The words for them, translated, come with Spotstrap.
- `basis` is the GDPR Art. 6(1) legal basis: `contract`, `legitimate-interests` or `consent`.
  `retentionDays` counts from last use, or for `backups` and `analytics` from when the backup
  or event was made; null when it isn't limited. `processor.country` is a
  two-letter code, `EU`, or null when unknown. `transfer.basis` `dpf` is the EU–US Data
  Privacy Framework.
- When the owner's details change, every site serves the new facts at once, and every app is
  deployed again to get the new `LEGAL_FACTS`. When the instance changes (backups turned on,
  another edge), `legal.json` follows when the agent starts, and `LEGAL_FACTS` with each app's
  next deploy.
- The app writes, in its own page, what it stores itself.
- Outside Spotcraft, set `LEGAL_FACTS` yourself, and serve the same JSON at that path.

## Analytics

Spotcraft counts how each app is used, with Umami on the instance
([ADR 0038](decisions/0038-analytics.md)). Nothing goes to an outside service, and nothing
collected holds an id, personal data or a cookie.

**How visits are counted is the instance's choice** (`ANALYTICS_MODE`,
[ADR 0043](decisions/0043-apps-own-their-ui.md)), because consent rules differ between EU
countries:

- `opt-out`, the default: the script below is added to pages; the visitor can turn it off.
- `opt-in`: nothing is added. The app asks the visitor first and loads
  `/_spotcraft/s.js` (with `data-website-id` from `config.json`) only after they agree.
- `server`: nothing runs in the browser, and `s.js` and `e` answer 404. Only requests and
  accounts are counted.

Events are kept `ANALYTICS_DAYS`, 395 by default, then deleted.

**What needs no change to the app** (in `opt-out` mode):

- **Page views:** Caddy adds
  `<script defer src="/_spotcraft/s.js" data-website-id="…"></script>` before `</head>` in
  `text/html` responses. A CSP of `script-src 'self'` allows it.
- **Requests:** requests, errors and latency per app, from Caddy.
- **Accounts:** new and active pool accounts per app, from the host each session was made or
  renewed on.

**Clients that can't be injected** (Expo, Electron) use `@kodentuzo/spotkit/client`, or do the
same by hand:

- `GET <app URL>/_spotcraft/config.json` answers
  `{ "analytics": { "websiteId": "<uuid>", "enabled": true, "mode": "opt-out" } }`. With
  `enabled: false`, send nothing. With `mode: "opt-in"`, send nothing until the user agrees.
- Screens and events go to `POST <app URL>/_spotcraft/e` as Umami event payloads, with a
  User-Agent that names the platform. Event data must not hold ids or personal data.
- Requests to the pool may carry `Spotcraft-Client: <platform>/<version>`, such as `ios/1.4.0`:
  lowercase letters and dashes, a slash, then up to 32 characters of letters, digits and `.+-`.
  The pool keeps it on the session to count platforms and versions; anything else is ignored.
- A native app shows an opt-out, and sends nothing once it's off.

**Analytics on or off** is a setting per app, on by default. Off removes the script and makes
`config.json` say `enabled: false`. Use it for an app with a nonce-only CSP, or one that mustn't
count.

## What the app does

- **Health:** a `HEALTHCHECK` in the image. Without one, Spotcraft asks for `GET /health` until
  it answers 2xx; a 404 counts too (the app answers, without that route). It waits 120 seconds.
- **Stop:** finish within 30 seconds of SIGTERM.
- **Logs:** to stdout, ideally JSON lines with `level`, `msg` and `time`.
