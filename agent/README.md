# @spotcraft/agent

Fastify service on the Spotcraft server that deploys apps when the dashboard asks. It is
reachable only on Docker networks (never on a host port), answers only the addresses in `AGENT_ALLOWED_IPS` (plus its own
loopback, for the health check), and requires a bearer token on every route but `/health`.

The files it writes are the only record of which apps exist:

```
/opt/spotcraft/apps/<name>/app.json      settings sent by the dashboard
/opt/spotcraft/apps/<name>/compose.yaml  generated Compose file (JSON, valid YAML)
/opt/spotcraft/apps/<name>/secrets.json  generated database password (mode 600, never returned)
/opt/spotcraft/apps/<name>/deploy.json   how the last deploy went: time, tag, ok or error
/opt/spotcraft/sites/<name>.caddy        generated Caddy site block
```

## API

| Method | Path                     | What                                                                                                                           |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/health`                | `{ ok: true }`, no token needed                                                                                                |
| GET    | `/settings`              | `{ appsDomain?, edge, dns, access }`: what is set up                                                                           |
| GET    | `/apps`                  | settings plus `state`, `health`, `status`, `hostnames`, `lastDeploy`                                                           |
| GET    | `/apps/:name`            | one app, or 404                                                                                                                |
| PUT    | `/apps/:name`            | create or update, then deploy; returns the app with status                                                                     |
| DELETE | `/apps/:name`            | stop and remove the app and its site; 204, or 404                                                                              |
|        |                          | `?purge=true` also deletes its database and role                                                                               |
| GET    | `/apps/:name/domain`     | custom domain status and records still to create                                                                               |
| GET    | `/apps/:name/logs`       | last `?tail=` lines (default 200, max 5000), plain text                                                                        |
| GET    | `/apps/:name/hook-token` | `{ enabled }`: whether the app has a deploy hook                                                                               |
| POST   | `/apps/:name/hook-token` | a new deploy hook token, returned once (201)                                                                                   |
| DELETE | `/apps/:name/hook-token` | turn the deploy hook off; 204                                                                                                  |
| POST   | `/apps/:name/release`    | `{ tag }` with `X-Hook-Token`: deploy that tag; 202                                                                            |
| GET    | `/apps/:name/release`    | with `X-Hook-Token`: how the last release went                                                                                 |
| GET    | `/backups`               | `{ enabled, apps }`: every app's last backup, or null                                                                          |
| GET    | `/apps/:name/backup`     | the app's last backup, or null                                                                                                 |
| POST   | `/apps/:name/backup`     | back it up now; the status (409 without backups)                                                                               |
| GET    | `/apps/:name/usage`      | `{ visits?, accounts? }` over `?days=` (7): counts, top pages, hosts, referrers, countries, devices, browsers, systems, events |
| GET    | `/apps/:name/database`   | `{ layout }`: `schema`, `database` (its own) or `none`                                                                         |
| POST   | `/apps/:name/move`       | `{ tag }`: move it from its own database into its schema                                                                       |
| GET    | `/pool/users`            | the user pool's users, newest first (`?limit=`, `?cursor=`)                                                                    |
| DELETE | `/pool/users/:id`        | delete a user and what every app kept for them; 204, 404, 409                                                                  |

`PUT` body (unknown fields are rejected):

| Field       | Default | Rule                                                      |
| ----------- | ------- | --------------------------------------------------------- |
| `image`     | —       | repository, e.g. `vindotski/tagtape` or `ghcr.io/org/app` |
| `tag`       | —       | Docker tag, e.g. `2.0.0`                                  |
| `domain`    | —       | custom domain; required only without `APPS_DOMAIN`        |
| `port`      | `3000`  | port the app listens on inside its container              |
| `env`       | `{}`    | environment variables (`$` is kept literal)               |
| `memory`    | `512m`  | memory limit, `<n>m` or `<n>g`                            |
| `cpus`      | `1`     | CPU limit                                                 |
| `readOnly`  | `true`  | read-only root filesystem with a 64 MB writable `/tmp`    |
| `database`  | `false` | its own Postgres database, given to it as `DATABASE_URL`  |
| `protected` | `false` | behind Cloudflare Access (needs an Access policy)         |
| `takeOver`  | `false` | deploys may replace a custom domain's foreign DNS records |

`database`, `protected` and `takeOver` keep their current value when left out.

App names: lower-case letters, digits and dashes, 2–32 characters. The names of the server's
own services (`caddy`, `cloudflared`, `agent`, `dashboard`, `auth`, `umami`, `postgres`,
`victoriametrics`, `vmagent`, `blackbox`, `node-exporter`, `cadvisor`), since an app's service joins the same
network, plus `www` and `fallback`, are reserved, and so is every name starting with `app-`
(Caddy reaches each app as `app-<name>`). A host can belong to one app only: a custom domain
can't be another app's default host, and no app may use `DASHBOARD_DOMAIN` or a reserved host
of the apps domain such as `fallback.<APPS_DOMAIN>` (409). The apex itself may be an app's.

With `APPS_DOMAIN` set, every app is served at `<name>.<APPS_DOMAIN>` (its default host,
first in `hostnames`) and, if it has one, at its custom domain too (ADR 0021).

Leaving out `protected` or `takeOver` in an update keeps the app's current setting (a new app
gets none). `database` is accepted and ignored: on a server with Postgres every app has one.

## Custom domains through Cloudflare

With `EDGE=cloudflare`, `APPS_DOMAIN` and all four of `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_APPS_ZONE_ID` and `CLOUDFLARE_TUNNEL_ID` (from
`infra/cloudflare`), the agent sets up each app's custom domain itself (ADR 0021). Set without
`EDGE=cloudflare` and `APPS_DOMAIN` (for example ahead of a switch), they are ignored and the
agent logs a notice at startup. A root domain
also gets `www.`.

- **The domain's zone is in the account**: the agent creates a proxied CNAME to the server's tunnel,
  with the comment `spotcraft:<name>`. It refuses (409) if the host already has A, AAAA or CNAME
  records it didn't make, unless the app's `takeOver` setting is on (ADR 0022). Other records such as MX and
  TXT are never touched.
- **Any other domain**: the agent creates a Cloudflare for SaaS custom hostname on the apps zone.
  Its owner adds a CNAME to `<name>.<APPS_DOMAIN>`, plus any TXT records `GET /apps/:name/domain`
  lists. Cloudflare then verifies the domain and issues its certificate.

DNS is set up before anything else in a deploy, and every host is checked before any is
changed. If the deploy then fails, or Cloudflare fails partway, DNS is put back exactly as it
was, including records a take-over replaced. No host may belong to two apps, including the
`www.` a root domain redirects. When the domain changes,
the old one's records go once the new version runs. Removing the app removes its records and
custom hostnames. Without these settings, `GET /apps/:name/domain` only says which records to
create by hand.

With `CLOUDFLARE_ACCESS_POLICY_ID` too (the owners' policy from `infra/cloudflare`), an app with
`protected: true` gets a Cloudflare Access application named `spotcraft:<name>` that covers every
host it answers on. Visitors sign in with a one-time code first. Protection goes on before the new
version takes traffic. If the deploy fails, the previous protection is put back, and removing
the app removes the Access application. Without the policy, `protected: true` returns 409.

## Deploying

Each app's Caddy site depends on `EDGE` and `APPS_DOMAIN`. When the agent starts, it rewrites
any site that doesn't match them and reloads Caddy (retrying while Caddy starts), so switching
modes applies to every app at once. A protected app's new hosts go behind Access first, next to its old ones,
and only once Caddy runs the new sites does Access drop the old hosts. If
Caddy rejects the rewrite, the previous sites are put back. An app left without any address
(no `APPS_DOMAIN` and no domain of its own) gets no site until it has one. The user pool's
own site, `sites/_auth.caddy` for `auth.<APPS_DOMAIN>`, is rewritten the same way.

An app runs in one of two slots, `blue` and `green`: Compose services named `<name>-blue` and
`<name>-green` in the app's project, `spotcraft-app-<name>`
([ADR 0028](../docs/decisions/0028-zero-downtime-deploys.md)). Its compose file holds only the
live slot. `PUT` deploys into the other slot, next to the live one:

1. It stages the new spec and compose file as `app.next.json` and `compose.next.yaml`, next to
   the live ones.
2. It runs `docker compose pull` and reads the image's config. If the image has the label
   `dev.spotcraft.migrate` (a JSON array: the command and its arguments), it runs that once,
   with `docker compose run --rm --no-deps` on the new slot's service and the command in place
   of the entrypoint, for up to 5 minutes
   ([ADR 0034](../docs/decisions/0034-app-contract.md)). A failure ends the deploy here. An
   app that still has its own database refuses such an image with a 409: the label marks a
   version made for the schema, which only a move (`POST /apps/:name/move`) may deploy.
3. It runs `docker compose up -d --wait` for the new slot's service only (up to 120 s for the
   container to run, and to be healthy if the image has a `HEALTHCHECK`). An image without one
   is then asked for `GET /health` from Caddy's container every 2 s for up to 120 s: a 2xx, or a
   404 (it answers on its port, without that route), counts as healthy. The live slot keeps
   serving.
4. It points the app's Caddy site at the new slot and commits: renaming `compose.next.yaml` to
   `compose.yaml` makes the new slot the live one. Then it reloads Caddy.
5. It stops the old slot with `docker stop --time 30`, so it can finish the requests it has, and
   removes it.

If a step fails, the new slot and the staged files are removed. The live slot, its files and
Caddy were never touched, so the app keeps serving its previous version (a new app is removed).
The response carries the error and the command output. Changes run one at a time.

When the agent starts, it recovers from a deploy it didn't finish. Files staged but not
committed are dropped, and a commit cut short between its two renames is finished. Then the
sites are rewritten for the live slots, Caddy reloads, and any container of a slot that isn't
live is removed. It also makes the env- and password-bearing files of every app directory
readable by the agent's user only, complete app or not.

So a deploy has no downtime, but for a few seconds both versions run against the app's
database: an app's migrations must only add. Its memory briefly doubles. An app deployed before slots has
one service named after it; its next deploy moves it into `blue`. Names ending in `-blue` or
`-green` are reserved, as are names starting with `app-`.

A `www.` site redirecting to the custom domain is added only for root domains (two labels,
e.g. `tagtape.app`); subdomains get none, so Caddy never requests certificates for unused names.
A root domain under a two-part suffix (`example.co.uk`) counts as a subdomain here and gets no
`www.`; point `www.` at the app yourself if you need it.
Every app's responses are compressed (zstd, gzip) and get these headers from Caddy:

- always: `Strict-Transport-Security` (a year, with subdomains), `X-Content-Type-Options: nosniff`
  and `Referrer-Policy: strict-origin-when-cross-origin`, and the `Server` header is removed;
- only if the app sends none of its own: `X-Frame-Options: DENY`, a `Permissions-Policy` that
  turns off camera, microphone, geolocation, payment and USB, and
  `Cross-Origin-Opener-Policy: same-origin`.

An app's own value for one of the defaults wins, so an app can loosen them. The
`Content-Security-Policy` is the app's to set, as no default fits every app.

- To be framed elsewhere, an app sends its own `X-Frame-Options`, or a CSP with `frame-ancestors`,
  which browsers follow instead.
- To use the camera, microphone, geolocation, payment or USB, it sends its own
  `Permissions-Policy` (e.g. `camera=(self)`). A CSP doesn't change these.
- For popups that need `window.opener` (some OAuth flows), it sends its own
  `Cross-Origin-Opener-Policy` (e.g. `same-origin-allow-popups`).

Every site sends `/_spotcraft/auth/*` to the user pool (`auth:3000`,
[ADR 0035](../docs/decisions/0035-auth-pool.md)) with the visitor's address in
`X-Spotcraft-Client-IP`, replacing whatever the client sent; every other path goes to the app.
With `APPS_DOMAIN`, `auth.<APPS_DOMAIN>/main/*` reaches the pool too, for clients without an app
domain; the name `auth` is reserved.

Every site also serves analytics ([ADR 0038](../docs/decisions/0038-analytics.md)):

- `/_spotcraft/s.js` and `/_spotcraft/e` go to Umami (`umami:3000`), the second with the visitor's
  address in `X-Spotcraft-Client-IP` for the country;
- `/_spotcraft/config.json` answers `{"analytics":{"websiteId":"…","enabled":true}}`, or
  `{"analytics":{"enabled":false}}`;
- `/_spotcraft/privacy` is a page saying what is counted, with a switch that stops counting in
  that browser.

With analytics on (the app's `analytics` isn't `false` and it has a website), the site asks the
app for uncompressed responses (`Accept-Encoding: identity`) and, in `text/html` responses only,
adds `<script defer src="/_spotcraft/s.js" data-website-id="…"></script>` before `</head>`,
streamed; `encode` then compresses for the visitor. Caddy runs from Spotcraft's image, built with
the `replace-response` module for this.

The agent gives each app an Umami website when it deploys it (named after the app, for its first
host) and keeps its id in `secrets.json` as `analyticsId`; removing the app deletes the website
and its numbers. It signs in as Umami's `admin`, replacing Umami's default password with
`UMAMI_ADMIN_PASSWORD` the first time. Umami being down never fails a deploy or a removal: the
site then counts nothing, and after a start the agent keeps trying in the background
(`backfillAnalytics`) until every app has a website.

`GET /apps/:name/usage` puts two counts together, each left out when its source can't answer:

- `visits`, from Umami: views, visitors and visits over the last `days`, the same before, and
  and the top ten pages, hosts, referrers, countries (ISO codes), devices, browsers, operating
  systems and custom events. A breakdown Umami refuses stays empty, and the rest still show;
- `accounts`, from the pool's sessions on the app's hosts: accounts active in the last day,
  7 days and 30 days, new accounts per day (their first session on these hosts), and active
  accounts per `Spotcraft-Client` value.

The dashboard adds the requests per app from Caddy's metrics.

Caddy passes the visitor's address to the app as `X-Forwarded-For`. With `EDGE=cloudflare`,
site blocks are plain HTTP (`http://host`): Cloudflare terminates TLS and a tunnel delivers
requests to Caddy.

Every app container gets: no Linux capabilities, `no-new-privileges`, memory/CPU/pids
limits, rotated logs (3 × 10 MB), and the `spotcraft-edge` network, where Caddy reaches it as
`app-<name>-<slot>`. Its `app.json` (which holds the env), compose file (which also holds
`DATABASE_URL` and `APP_SECRET`) and `secrets.json` are readable by the agent's user only.

Every app also gets Spotcraft's env ([ADR 0034](../docs/decisions/0034-app-contract.md)), which
wins over its own; a `PUT` whose env sets one of these names gets a 400:

| Env                                        | Value                                                             |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `PORT`, `APP_NAME`, `APP_RELEASE`          | the app's port, name and image tag                                |
| `APP_SECRET`                               | 32 random bytes (base64url), made once and kept in `secrets.json` |
| `PUBLIC_URL`                               | `https://` and its custom domain, else its default host           |
| `AUTH_URL`, `AUTH_JWKS_URL`, `AUTH_ISSUER` | the user pool on its domain, with `AUTH_ISSUER` set               |
| `DATABASE_URL`, `DATABASE_SCHEMA`          | its schema, on a server with Postgres                             |

`SMTP_URL` and `MAIL_FROM` are reserved too, for instance SMTP.

## Deploy hook

An app's CI can deploy a new tag through the dashboard's `/hooks/deploy/<name>`, which relays
to `/apps/:name/release` ([ADR 0029](../docs/decisions/0029-deploy-hook.md), guide:
[Deploy from CI](../docs/guides/deploy-from-ci.md)).

- **The token.** `POST /apps/:name/hook-token` makes a token (32 random bytes, base64url) and
  keeps only its SHA-256 in the app's `secrets.json`; a new one replaces the old. It is never
  part of the app as the API returns it.
- **The routes check it.** The release routes take it in `X-Hook-Token`, next to the dashboard's
  own token, and compare digests in constant time. A missing, wrong or rotated token, an app without
  a hook and an app that doesn't exist all get 401.
- **A release changes only the tag,** and never takes over DNS records. It reads the stored
  spec inside the deploy queue, so an edit queued before it is kept, and answers 202 at once.
- **One release per app waits.** A newer one cancels the waiting one and queues behind
  anything queued meanwhile. When it runs, the token it came with must still be the app's. Token
  changes have their own lock on `secrets.json`, not the deploy queue, so they answer at once
  and cancel a waiting release straight away.
- **Its state** (`deploying`, `live`, `failed` with the agent's message, no command output) is
  kept in memory, the latest release per app, and forgotten when the token changes, the app is
  removed, or the dashboard deploys it. Without a record, `GET` answers `live` with the app's
  tag once startup recovery has finished, and 503 before. Without one since the agent started, `GET`
  answers `live` with the app's tag.

## Backups

With the four `BACKUP_*` settings, the agent backs up every app at 03:00 UTC to an
S3-compatible bucket ([ADR 0030](../docs/decisions/0030-backups.md), guide:
[Backups and restoring](../docs/guides/backups.md)). Each app gets a folder
`<name>/<time>/` (`20261114T030000Z`) with:

- `database.dump`, for an app with a database: `pg_dump --format=custom`, run with
  `docker exec` in `POSTGRES_CONTAINER` as the superuser over its local socket, with
  `--lock-wait-timeout=30s` and 5 minutes in all (`timeout` inside the container). It is held in
  memory, up to 32 MB; a larger one fails with that reason.
- `app.json` and `secrets.json`, as they are on disk.

Each app's backup takes its own turn in the deploy queue, so deploys can go between them. Each
upload has a minute. A backup on request is refused (409) while one for that app is waiting.
The result goes into `apps/<name>/backup.json`, written to a temp file and renamed (a file that
can't be read counts as no backup yet): `{ at, ok, key, bytes, lastOkAt }`, or `error` in place
of `key` and `bytes`. A failure is also logged. Uploads are signed with AWS SigV4
(`src/s3.ts`), path-style, with region `auto`.

| Setting                    | What                                                       |
| -------------------------- | ---------------------------------------------------------- |
| `BACKUP_S3_ENDPOINT`       | `https://<account>.r2.cloudflarestorage.com`, an origin    |
| `BACKUP_BUCKET`            | the bucket                                                 |
| `BACKUP_ACCESS_KEY_ID`     | the key: object read and write on that bucket only         |
| `BACKUP_SECRET_ACCESS_KEY` | its secret                                                 |
| `POSTGRES_CONTAINER`       | where `pg_dump` runs (default `spotcraft-apps-postgres-1`) |

All four `BACKUP_*` or none; the agent refuses to start with some.

## App databases

Apps share one database on the apps server's Postgres, `apps`, like a Supabase project
([ADR 0034](../docs/decisions/0034-app-contract.md)). On a server with Postgres every app has one (`database` in a `PUT` is ignored); a deploy first
prepares the app's role and schema there, both `app_<name>` (dashes as underscores), using
`@kodentuzo/spotcraft/provision` from [the CLI package](../packages/cli/README.md), so a laptop gets the
same setup. The agent creates `apps` and the `spotcraft_app` group role the first time.

- The role owns its schema and has it as its `search_path`. It may connect to `apps` and
  nothing else: it can't create schemas or extensions, or see other apps' schemas.
- Every app role belongs to `spotcraft_app`, which the user pool will let read and reference
  `auth.users` ([ADR 0035](../docs/decisions/0035-auth-pool.md)).
- The schema starts empty: apps run their own migrations.

Only then are the files written, so a schema that can't be prepared changes nothing (the error
and Postgres's message come back as a 502). The password is generated on the first deploy and
kept in `secrets.json`. The app gets `DATABASE_URL=postgres://app_<name>:…@postgres:5432/apps`
and `DATABASE_SCHEMA=app_<name>`, which its own env can't set. It reaches Postgres on
`spotcraft-edge`, and the agent reaches it on the internal `db` network.

**Apps made before ADR 0034** keep their own database, `app_<name>`, with the kit's `auth`
schema, and get only `DATABASE_URL` to it. Nothing migrates `auth` any more. Backups and purges
handle both.

`POST /apps/:name/move` with `{ tag }` moves such an app into its schema and its guests into the
user pool ([guide](../docs/guides/move-into-the-pool.md)). `tag` is a version made for the
schema and the pool. In the queue, it:

1. backs the app up, if backups are set up, and stops if that fails;
2. deploys `tag` as usual, with the schema set up although the app has its own database. The
   role's `search_path` is set in `apps` only, so the running version still finds its tables;
3. after the new version's migrations, copies in one transaction:
   - the kit's guests and their live sessions into `auth.users` and `auth.sessions`, with the
     same ids and tokens;
   - the app's `AUTH_SECRET` into `auth.former_secrets`, so the pool accepts the guests'
     cookies (signed with it) and re-signs them;
   - the rows of each table in the old `public` that the new version made in its schema and
     left empty, in foreign-key order, by column name; serial columns continue after them.
     Tables the migrations filled (their journal, say) are left alone;
4. starts the new version, as any deploy.

It answers `{ status, moved: { users, sessions, tables } }`. What the old version writes after
the copy stays behind, so pick a quiet moment. If anything fails, the schema is dropped and the
old version keeps running on its own database. After a move the schema wins: the old database
stays, unused, until you drop it (`DROP DATABASE app_<name>` as `postgres`).

Removing an app keeps its schema (and the data in it). `DELETE ?purge=true` drops the schema,
or the old app's database, and its role after the app is removed. To delete the data of an app
that was already removed, add it again and remove it with `?purge=true`.

When the agent starts, it brings every app's role and grants up to date. Postgres may still be starting, so failures
are retried every 5 seconds for 3 minutes and logged.

Without `POSTGRES_URL`, the agent runs as before, and asking for a database returns 409.

## The user pool's users

The agent reads and deletes the user pool's users ([ADR 0035](../docs/decisions/0035-auth-pool.md))
in the `auth` schema of the `apps` database. The pool grants it `SELECT` on `auth.users` and
`auth.sessions`, `DELETE` on `auth.users`, and `INSERT` on `auth.users`, `auth.sessions` and
`auth.former_secrets` for moves, and nothing else. It works while the pool is down.

- `GET /pool/users` returns `{ available, total, guests, users, next }`. Each user has `id`,
  `guest` (no sign-up), `createdAt` and `lastSeen` (their most recently used session, or
  `null`). Pages hold `?limit=` users (default 50, max 200); pass `next` back as `?cursor=` for
  the older ones. `available` is false until the pool has set up `auth` and its grants.
- `DELETE /pool/users/:id` (a uuid) deletes the user. Their sessions, and every app's rows for
  them, go with them through the foreign keys' cascades. An app's foreign key that blocks the
  delete answers 409, naming its table.
- A server without Postgres answers 409.

Apps made before ADR 0034 keep their guests in their own database's `auth` schema until they
move to the pool (`POST /apps/:name/move`); the dashboard doesn't show those.

## Settings

| Env                    | Default                  | Meaning                                          |
| ---------------------- | ------------------------ | ------------------------------------------------ |
| `AGENT_TOKEN`          | —                        | required, at least 32 characters                 |
| `HOST`                 | `127.0.0.1`              | bind address                                     |
| `PORT`                 | `4000`                   | listen port                                      |
| `DATA_DIR`             | `/opt/spotcraft`         | holds `apps/` and `sites/`                       |
| `CADDY_CONTAINER`      | `spotcraft-apps-caddy-1` | container reloaded after site changes            |
| `POSTGRES_URL`         | —                        | the agent's Postgres role (optional)             |
| `APPS_DOMAIN`          | —                        | apps get `<name>.<APPS_DOMAIN>`                  |
| `DASHBOARD_DOMAIN`     | —                        | the dashboard's host; apps can't use it          |
| `AUTH_ISSUER`          | —                        | the user pool's `iss`; apps get AUTH_*           |
| `EDGE`                 | `direct`                 | `cloudflare`: sites are plain HTTP               |
| `UMAMI_URL`            | —                        | analytics (ADR 0038), with the password          |
| `UMAMI_ADMIN_PASSWORD` | —                        | at least 32 characters; replaces Umami's default |
| `CLOUDFLARE_*`         | —                        | custom domains, Access (see below)               |
| `LOG_LEVEL`            | `info`                   | log level                                        |

The agent runs from the `spotcraft` image (the root `Dockerfile`, shared with the dashboard;
Compose starts it with `working_dir: /app/agent` and `command: ["src/index.ts"]`): distroless
Node 26 (no shell or package manager) plus the static Docker CLI and Compose plugin. It runs as uid 1000 and reaches Docker through the socket's group (`group_add`
with `DOCKER_GID`); the Docker CLI keeps its config in `/tmp` so the root filesystem can be
read-only. Mounting the Docker socket still makes the agent
equivalent to root on the server; the internal `control` network (only the dashboard is there),
`AGENT_ALLOWED_IPS` and the token protect it.

The workspace runs the kit's TypeScript source (the `spotcraft-source` export condition, set in the
`dev` and `test` scripts and in `tsconfig.json`). The image ships the kit's built JavaScript,
because Node won't run TypeScript from `node_modules`.

```sh
pnpm --filter @spotcraft/agent test        # node:test; the database test needs KIT_TEST_POSTGRES_URL
pnpm --filter @spotcraft/agent typecheck
docker build .                             # the spotcraft image, from the repository root
```
