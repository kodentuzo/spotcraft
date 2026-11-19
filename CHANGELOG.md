# Changelog

All notable changes to Spotcraft are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). What counts as
Spotcraft's public API, and so what makes a change breaking, is defined in
[ADR 0019](docs/decisions/0019-one-version-with-npm.md). While the version is 0.y.z, a breaking change
raises the minor version and is listed under **Changed** or **Removed** with migration steps.

## [Unreleased]

### Changed

- **Users pages:** the pool's Users page and an app's are now the same page: users and guests,
  accounts active today, in 7 and 30 days, new accounts per day and app versions, then the
  users with Delete. An app's lists the users with a session on it, last seen there
  ([ADR 0040](docs/decisions/0040-admin-sees-app-users.md)). The agent's `GET /pool/users`
  takes `?app=`, and `GET /pool/usage` gives the pool's counts.
- **Dashboard sidebar:** every signed-in page gets a sidebar (instance domain and version, the
  sections, Log out) and a header bar with an app switcher, the section's title and Add app; on
  a phone the sidebar is a drawer. Each section (Overview, Usage, Logs, Server, Domains,
  Backups, Users, Settings) shows every app, or the app picked in the switcher, app first:
  `/<app>` and `/<app>/usage`. Adding an app is `/new`. Old `/apps/<app>` links redirect.
  Above Log out, who is signed in: the Access email with its Gravatar, or "Admin" for the
  password.
- **App names** (breaking, unlikely to matter): the dashboard's pages are now reserved names,
  since an app's pages are `/<app>/…`: `new`, `apps`, `api`, `hooks`, `login`, `logout`,
  `usage`, `logs`, `server`, `domains`, `backups`, `users`, `settings`. To upgrade, rename an
  app with one of these names first (add it under the new name, then remove the old one).
- **Dashboard home:** an overview (apps running, server memory and disk, backups when set up)
  above a list with a row per app: its icon (from its site) or initial, status, last deploy,
  24 hourly uptime bars, memory against its limit, and visitors (or requests without
  analytics). A failed backup, deploy or custom domain shows only when there is one. Apps
  that need a look come first.
- **App page:** a header with the app's icon, status and address (Redeploy, Edit, Visit);
  failures first, then the deployment, its health and its usage totals. Its other pages are
  the sidebar's sections for that app (Settings ends with Remove).
- **Usage panels:** an app's Usage page opens with a chart of the last 7 days, with tabs for
  visitors, page views, new accounts and requests and each one's change from the week
  before. Then it breaks its visits down by page and host, referrer,
  country, device and browser, operating system, custom event (`umami.track`) and app
  version. The agent asks Umami for each; one Umami can't give stays empty.
- **Agent:** records each app's last deploy (time, tag, and the error if it failed) in
  `deploy.json`, and returns it as `lastDeploy` with the app
  ([ADR 0039](docs/decisions/0039-app-status-at-a-glance.md)). Apps show it after their next
  deploy.

## [0.7.0] - 2026-11-19

Every app counts its usage, with no change to the app
([ADR 0038](docs/decisions/0038-analytics.md)). Spotcraft runs Umami for the instance, Caddy adds
its script to apps' HTML pages, and each app's page in the dashboard gets a Usage section:
visitors and page views, the user pool's active and new accounts, requests with errors and
latency, and the top pages, systems and app versions. Counts only: no cookies, and nothing that
identifies a visitor.

**Upgrading from 0.6:**

1. **Rename any app called `umami`** (breaking): it is now a reserved name, like the server's
   other services.
2. **Deploy `0.7.0`** with the Deploy workflow. It generates the new passwords and secret in
   `.env`, creates Umami's database and role, and runs Caddy from Spotcraft's image. When the
   agent starts, it gives every app its Umami website, so apps start counting without a
   redeploy.
3. **Check an app with a strict CSP.** The script is same-origin, so `script-src 'self'` allows
   it; an app whose CSP allows only scripts with a nonce should turn **Analytics** off in its
   settings.

The server needs about 512 MB more for Umami.

### Added

- **Analytics with Umami** ([ADR 0038](docs/decisions/0038-analytics.md)): an `umami` container
  with its own `umami` database and role, set up by the deploy script, which generates
  `POSTGRES_UMAMI_PASSWORD`, `UMAMI_SECRET` and `UMAMI_ADMIN_PASSWORD` and keeps them in `.env`.
  The agent replaces Umami's default admin password with the generated one. Nightly backups add
  `_umami/<time>/umami.dump`. `spotcraft dev` runs Umami too and prints its address (sign in as
  `admin` / `umami`); a stack made before keeps its ports and gets one more.
- **Every app counts its visits.** On deploy, the agent gives the app a website in Umami, kept
  with the app and deleted with it, and Caddy adds Umami's script before `</head>` in the app's
  HTML responses. Apps already running get theirs when the agent starts. If Umami is down, a
  deploy still goes through and counting starts later. The app form has an **Analytics** switch,
  on by default.
- **Each app's usage in the dashboard:** visitors and page views from Umami (7 days, against
  the 7 before), the pool's active accounts (today, 7 and 30 days) and new accounts per day,
  requests, the share of errors and p95 latency from Caddy over 24 hours, and the top pages,
  operating systems and app versions. The agent answers `GET /apps/:name/usage`.
- **The app contract's analytics** ([docs/contracts.md](docs/contracts.md#analytics)): every app
  domain serves `/_spotcraft/s.js`, `/_spotcraft/e`, `/_spotcraft/config.json` (the app's
  analytics id, for native clients) and `/_spotcraft/privacy` (what is counted, with an opt-out
  for the browser). Clients may send `Spotcraft-Client: <platform>/<version>` to the pool.
- **The user pool records on each session** the host it was made or renewed on and the
  `Spotcraft-Client` header (its migration 0004).

### Changed

- **Caddy runs from Spotcraft's own image**, built with the `replace-response` module, instead of
  the official `caddy` image. Same version (2.11.9), same volumes, so certificates carry over.
  It exports requests per host on port 2020, to the monitoring network only. The agent's health
  probe for images without a `HEALTHCHECK` now runs with Node in Caddy's container.
- `umami` is a reserved app name.

### Fixed

- **An app that still has its own database refuses a version made for its schema.** A deploy,
  from the dashboard or the deploy hook, of an image with the `dev.spotcraft.migrate` label
  now fails with a 409 until the app is moved
  ([guide](docs/guides/move-into-the-pool.md)). Before, the migrations ran against the old
  database and the new version started there, with guests from the pool the database didn't
  know, so its saves failed until the move.

## [0.6.1] - 2026-11-19

### Fixed

- **The contract's advice for Drizzle** ([docs/contracts.md](docs/contracts.md#database)).
  Drizzle's `migrate()` and `drizzle-kit migrate` run `CREATE SCHEMA IF NOT EXISTS` first, which
  Postgres refuses to an app's role even when its schema exists, so setting `migrationsSchema`
  wasn't enough. The contract now shows a few lines that apply drizzle-kit's files in Drizzle's
  own journal table.

- **`spotcraft dev` gives every checkout its own stack:** a new stack is the Compose project
  `spotcraft-dev-<repo folder>-<hash>`, where the hash is 6 hex characters of the repository
  root's path. Before, two checkouts or git worktrees with the same folder name shared one
  project, volume and network, and overwrote each other's ports. The name is kept in
  `.spotcraft/dev.json` on first use. A stack made by 0.6.0 keeps its name
  (`spotcraft-dev-<repo folder>`), so an app's Compose file that names the stack's network
  (e.g. `spotcraft-dev-vinskiano_default`) keeps working. For a new stack, take the name from
  `spotcraft dev status` (the network is `<name>_default`). To split two checkouts that share
  a 0.6.0 stack, delete `.spotcraft/dev.json` in one of them and run `spotcraft dev` there: it
  gets a new stack with new ports, so its `.env` URLs need the new values (`spotcraft dev env`).

## [0.6.0] - 2026-11-19

### Added

- **Moving an app into the user pool** ([guide](docs/guides/move-into-the-pool.md)): an app
  made before ADR 0034, with its own database and the kit's guests, moves into its schema with
  one form on its dashboard page (`POST /apps/:name/move` with the new version's tag). The agent
  backs it up, deploys the new version, and between its migrations and its start copies the
  guests and live sessions into the pool with the same tokens, and the rows of the tables the
  new version made. The pool re-signs cookies signed with the app's old `AUTH_SECRET`, so
  guests stay signed in. If anything fails, the old version keeps running. The old database is
  kept until you drop it. `GET /apps/:name/database` says where an app's tables are.

- **`spotcraft dev` runs a stack per repository** ([ADR 0037](docs/decisions/0037-local-stack-per-repo.md)):
  Postgres set up as on the server, the user pool, and Mailpit, on free ports kept in
  `.spotcraft/dev.json`. One command starts it, sets up the app's schema, adds the server's
  setting names to `.env` and runs `migrate` from the new `spotcraft.json`. Also `dev env`,
  `dev db reset`, `dev migrate`, `dev status`, `dev stop` and `dev ls`.

- **The dashboard's Users page** (`/users`) lists the user pool's users, shared by every app,
  with how many are guests, and deletes one with what every app kept for them
  ([ADR 0035](docs/decisions/0035-auth-pool.md)). If an app's foreign key keeps a user's rows,
  the page says which table. The agent's routes are `GET /pool/users` and
  `DELETE /pool/users/:id`.

- **Apps get the user pool and Spotcraft's env** ([ADR 0034](docs/decisions/0034-app-contract.md),
  [ADR 0035](docs/decisions/0035-auth-pool.md)):
  - every site sends `/_spotcraft/auth/*` to the user pool, with the visitor's address set by
    Caddy, and `auth.<APPS_DOMAIN>/main/*` reaches it for clients without an app domain;
  - every app gets `PORT`, `PUBLIC_URL`, `APP_NAME`, `APP_RELEASE`, `APP_SECRET` (made once and
    kept), `AUTH_URL`, `AUTH_ISSUER`, `AUTH_JWKS_URL`, and on a server with Postgres
    `DATABASE_URL` and `DATABASE_SCHEMA`;
  - **migrations run on the server**: an image's `dev.spotcraft.migrate` label (a JSON array)
    runs once per deploy, before the new version starts; if it fails, the old one keeps serving;
  - an image without a `HEALTHCHECK` must answer `GET /health` (or at least its port) before
    traffic moves to it.

- **The user pool** (`auth`, [ADR 0035](docs/decisions/0035-auth-pool.md)): a new service from
  the Spotcraft image, Better Auth over the `auth` schema of the shared `apps` database. For now
  it makes guests, with a first-party cookie on whichever app domain asked, a bearer token for
  clients elsewhere, and 15-minute EdDSA JWTs that apps check against its JWKS. Apps may read
  and reference `auth.users`. Guests unused for 180 days are deleted, and the nightly backup
  dumps `auth` to `_auth/` in the bucket. Nothing routes to it yet; Caddy's route on app
  domains comes next.

  **Upgrading:** nothing to set. The deploy now starts Postgres first and creates the `apps`
  database, the `spotcraft_app` group and the pool's role and schema, and generates
  `POSTGRES_AUTH_PASSWORD` and `AUTH_SECRET` into `.env`. Optional: the GitHub variable
  `AUTH_TRUSTED_ORIGINS` for bearer clients on other sites. The server needs about 192 MB more.

- **The planned app contract** ([docs/contracts.md](docs/contracts.md)): what every app gets and
  what it must do. Decided in four records, none built yet:
  - every app gets the same env vars and its own schema in one instance database, like a
    Supabase project, and the server runs its migrations
    ([ADR 0034](docs/decisions/0034-app-contract.md));
  - one user pool per instance, starting with guests ([ADR 0035](docs/decisions/0035-auth-pool.md));
  - the kit becomes `@kodentuzo/spotkit` in its own repository, and the CLI becomes
    `@kodentuzo/spotcraft` ([ADR 0036](docs/decisions/0036-spotkit.md));
  - each repository gets its own local stack ([ADR 0037](docs/decisions/0037-local-stack-per-repo.md)).

### Changed

- **The CLI is now `@kodentuzo/spotcraft`** on npm (the command is still `spotcraft`), with a
  new local stack (breaking). **Migrating:** `npm install --save-dev @kodentuzo/spotcraft` and
  run `npx spotcraft dev`. Apps on `@spotcraft/kit` keep `spotcraft@0.5`. The old shared stack
  (`spotcraft-dev`) is left as it is; remove it with
  `docker compose -p spotcraft-dev down -v` when nothing needs it.

- **The per-app Users page and the agent's `/apps/:name/users` routes are gone** (breaking for
  API callers). Guests of apps made before ADR 0034 stay in their own database until those apps
  move to the pool, and aren't listed meanwhile.

- **Every app has a database on a server with Postgres** (breaking). The dashboard's Database
  checkbox is gone and `database` in the agent's API is ignored; an app without one gets its
  schema on its next deploy.
- **An app's env can't set Spotcraft's names** (breaking): `PORT`, `PUBLIC_URL`, `APP_*`,
  `DATABASE_*`, `AUTH_URL`, `AUTH_ISSUER`, `AUTH_JWKS_URL`, `SMTP_URL`, `MAIL_FROM`. Saving such
  an app answers 400. `auth` is a reserved app name.

  **Migrating:** before you next edit an app in the dashboard, remove these names from its env
  (`PUBLIC_URL` is the usual one; Spotcraft now sets it to the custom domain, else the default
  host). Deploys through the hook keep working until then, with Spotcraft's values winning.

- **A new app with a database gets a schema, not a database** (breaking for apps on
  `@spotcraft/kit`). Apps share one database, `apps`, like a Supabase project: each has its own
  schema and role, `app_<name>`, with the schema as its `search_path`
  ([ADR 0034](docs/decisions/0034-app-contract.md)). It gets `DATABASE_URL` and the new
  `DATABASE_SCHEMA`, and can't create schemas or see other apps'. There is no `auth` schema in
  it: users will come from the instance's pool ([ADR 0035](docs/decisions/0035-auth-pool.md)).
  Backups dump the app's schema, and the backups guide restores it as the app's role. The same
  holds locally with `spotcraft dev`; `dev status` no longer shows an `auth` schema version.

  **Migrating:** apps that already have their own database keep it, with their `auth` schema
  and data, until they move to the pool; nothing migrates `auth` any more. A new app that uses
  `@spotcraft/kit` can't get a database on this version, since the kit needs an `auth` schema it
  can't create. Locally, keep such an app on `spotcraft` 0.5 until it moves.
- **The theme comes from [spotstrap](https://spotstrap.dev)** (`@kodentuzo/spotstrap`), the
  owner's UI library, through `@spotcraft/ui`
  ([ADR 0033](docs/decisions/0033-theme-from-spotstrap.md)). The colors, corners and font stay
  the same. Body text is 17px instead of 16px, muted text is slightly darker, and the website's
  buttons are 44px tall.
- **The dashboard's buttons, fields and dialogs use spotstrap's classes.** Buttons and fields
  are 44px tall (were 36px), with 17px text. The users table's Delete is 36px with a 44px hit
  area. Destructive buttons are solid red. On a phone, the confirmation dialog opens as a sheet at
  the bottom of the screen, its buttons full width, over a darker backdrop.

## [0.5.2] - 2026-11-18

The repository moved to the kodentuzo organization, with updated server images.

### Changed

- **The repository moved to [kodentuzo/spotcraft](https://github.com/kodentuzo/spotcraft).** Old
  links redirect. Forks can update their upstream remote:
  `git remote set-url upstream https://github.com/kodentuzo/spotcraft.git`. The Docker image
  is still `vindotski/spotcraft`.
- **Server images:** Postgres 18.7 (also in the local stack and CI), Caddy 2.11.9 (new digest),
  cloudflared 2026.11.1 and cAdvisor 0.61.0.

## [0.5.1] - 2026-11-18

### Added

- **`backup_jurisdiction` in `infra/cloudflare`** keeps the backup bucket in the EU (`eu`) or
  FedRAMP (`fedramp`) jurisdiction, and `backup_settings` gives that jurisdiction's endpoint. The
  backups guide also shows how to import a bucket made by hand.

## [0.5.0] - 2026-11-14

Releases without downtime, a deploy hook for an app's CI, nightly backups of every app to R2
with Hetzner's server backups on, and default security headers for apps. It ships kit 0.4.0,
released first, with adapters for Nuxt and TanStack Start; apps upgrade the kit when they like.

**Upgrading from 0.4:**

1. **Rename any app whose name ends in `-blue` or `-green`** (breaking, see "Deploys have no
   downtime" below).
2. **Run `tofu apply` in `infra/cloudflare`.** With Cloudflare Access, it adds the bypass for
   the deploy hook. With `backup_bucket` set, it makes the R2 bucket.
3. **Run `tofu apply` in `infra/hetzner`.** It turns on the server's backups in place; check
   that the plan doesn't replace the server.
4. **For backups,** add the `BACKUP_*` variables and secrets (see "Backups" below). Without
   them, the agent runs as before, with no backups.
5. **Deploy `0.5.0`** with the Deploy workflow. Existing apps move into a slot on their next
   deploy.

### Added

- **Backups** ([ADR 0030](docs/decisions/0030-backups.md), guide:
  [Backups and restoring](docs/guides/backups.md)):
  - **Nightly, to a bucket.** Every night at 03:00 UTC, the agent backs up each app to an
    S3-compatible bucket: a `pg_dump` of its database, and its `app.json` and `secrets.json`.
  - **In the dashboard.** It shows each app's last backup, red when it failed or is over a day
    old, and the app page has **Back up now**.
  - **In `infra/cloudflare`,** `backup_bucket` makes an R2 bucket that deletes backups after
    `backup_retention_days` (30). A bucket lock keeps them from being deleted or overwritten
    before then, even with the agent's key.
  - **Restoring** is a documented procedure that restores each part as the role that owns it,
    never as the superuser alone, because an app's dump can hold code that runs during a
    restore.
  - **To turn it on:**
    1. Set `backup_bucket` and run `tofu apply`. This needs R2 enabled and the module's token
       to have Workers R2 Storage: Edit.
    2. Add the `backup_settings` output as variables.
    3. Make an R2 token for the bucket and add it as the secrets `BACKUP_ACCESS_KEY_ID` and
       `BACKUP_SECRET_ACCESS_KEY`.
    4. Deploy.

- **A deploy hook, so an app's CI can deploy every build**
  ([ADR 0029](docs/decisions/0029-deploy-hook.md), guide:
  [Deploy from CI](docs/guides/deploy-from-ci.md)):
  - Turn it on in the app's page in the dashboard and save the token, shown once, in the app's
    repository.
  - CI POSTs the new tag to `/hooks/deploy/<name>` and polls until it is live.
  - Only the tag changes; the image, env and limits stay as set in the dashboard.
  - **Upgrading with Cloudflare Access:** run `tofu apply` in `infra/cloudflare`. It adds an Access
    application that lets `<dashboard>/hooks/deploy` through without a sign-in.

- **Default security headers for apps.** Caddy sends `X-Frame-Options: DENY`, a
  `Permissions-Policy` that turns off camera, microphone, geolocation, payment and USB, and
  `Cross-Origin-Opener-Policy: same-origin`, but only when the app doesn't send its own. The
  app's CSP stays its own to set. To override a default:
  - **framing:** an app meant to be framed sends its own `X-Frame-Options`, or a CSP with
    `frame-ancestors`, which browsers follow instead;
  - **camera, microphone, geolocation, payment or USB:** the app sends its own
    `Permissions-Policy` allowing them, e.g. `camera=(self)`. A CSP doesn't change these;
  - **popups that need `window.opener`** (some OAuth flows): the app sends its own
    `Cross-Origin-Opener-Policy`, e.g. `same-origin-allow-popups`.

### Changed

- **Hetzner's daily server backups are on by default** (`apps_server_backups = true` in
  `infra/hetzner`, +20% of the server's price). `tofu apply` turns them on for a server where the
  variable isn't set. Set it to `false` to keep them off.

- **Deploys have no downtime.** The agent starts the new version in a second slot next to the
  live one, moves traffic once it is healthy, then stops the old one, which gets 30 seconds to
  finish its requests. A version that fails never takes traffic, and the old one isn't restarted
  ([ADR 0028](docs/decisions/0028-zero-downtime-deploys.md)). For a few seconds both versions run
  against the app's database, so an app's migrations must only add; its memory briefly doubles.
  Existing apps move into a slot on their next deploy, with no steps needed. **Breaking:** app
  names ending in `-blue` or `-green` are now reserved. Rename such an app (add it under a new
  name, then remove the old one) before upgrading.

### Fixed

- **An app's `app.json`, which holds its env, is readable by the agent's user only.** It was
  written with the default mode (usually world-readable). The agent fixes existing files when it
  starts.

## [0.4.1] - 2026-11-13

A fix for Log out behind Cloudflare Access. No upgrade steps: deploy `0.4.1`.

### Fixed

- **Log out with Cloudflare Access** now lands on the Access sign-in. Before, the dashboard's
  CSP (`form-action 'self'`) blocked Cloudflare's redirect to the team domain, so the page stayed
  put until a refresh. The CSP now allows `https://*.cloudflareaccess.com` for form redirects,
  and the logout passes `returnTo` so Cloudflare sends the browser back to the dashboard.

## [0.4.0] - 2026-11-13

Spotcraft runs on one server, from one image, and its website moved to GitHub Pages. Signing in
through Cloudflare Access now opens the dashboard without its password, and the kit has its own
version (0.3.1, released first). An audit before the release closed several security gaps.

**Upgrading from 0.3** takes the steps under "Spotcraft runs on one server" below: new deploy
variables (`SERVER_HOST`, `CLOUDFLARE_TUNNEL_TOKEN`), one Deploy run that switches to the new
`spotcraft` image and the `infra/server` stack, then the OpenTofu changes and clean-up. Other
breaking changes: the agent API takes `takeOver` in the body, and app names starting with `app-`
are refused. Optionally, set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` for the Access sign-in.

### Added

- **The website moved to GitHub Pages** ([ADR 0024](docs/decisions/0024-website-on-pages.md)).
  It's now plain Astro with no client-side JavaScript, deployed from `main` by the new Pages
  workflow, with a build check for missing pages, broken links and anchors. The URLs are
  unchanged.

- **One sign-in behind Cloudflare Access** ([ADR 0023](docs/decisions/0023-access-sign-in.md)):
  with the new `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` variables on the `production`
  environment, the dashboard accepts Access's signed token and skips its password. Log out
  also ends the Access sign-in. `infra/cloudflare` has a new `dashboard_settings` output with
  the AUD. The password login stays for use without Access.

- The dashboard shows the running Spotcraft version in its footer once you're signed in,
  linked to the release notes.

### Removed

- **The `spotcraft-agent` and `spotcraft-dashboard` images**: one image, `spotcraft`, now runs
  both as two containers ([ADR 0025](docs/decisions/0025-one-image.md)). **Breaking:** take the
  new `infra/*/compose.yaml` files (the deploy copies them), which use `SPOTCRAFT_IMAGE`; a
  fork publishes `<DOCKERHUB_USERNAME>/spotcraft`. Run the Deploy workflow with a tag of the
  new image. The old images stay on Docker Hub but get no new versions.
- The `spotcraft-site` image is no longer built or published; the site isn't an app on the
  apps server any more.

### Security

- A crafted dashboard link with an encoded `?` or `#` in the app name (for example
  `/apps/blog%3Fpurge=true`) could turn Remove into "remove and delete the database", or a user
  delete into an app delete. App routes now only match valid names, and agent calls encode them.
- App names starting with `app-` are refused: `app-<name>` is how Caddy reaches each app, so such
  an app could receive another app's traffic.
- A custom domain can't be one of the apps domain's own hosts (`fallback.`, `www.`…), whose
  records OpenTofu manages.
- Each app's `compose.yaml`, which carries its database password, is now mode 600, like
  `secrets.json`. The agent tightens existing ones when it starts.
- The dashboard's login lockout counts an IPv6 client by its /64 and no longer grows without
  bound.
- The agent and the kit pin `search_path` when they work in an app's database.

### Changed

- **Performance**: cAdvisor collects only containers' CPU and memory, every 30 seconds, with the
  Compose project label (about a sixth of the series). An app's page no longer waits for the app
  before starting its metric queries and logs, and streams its domain status (which asks
  Cloudflare) instead of waiting for it; the edit page streams Docker Hub's tags. The image
  build fetches dependencies from the lockfile in their own cached layer.
- **`@spotcraft/kit` has its own version** ([ADR 0027](docs/decisions/0027-kit-version.md)) and
  its own [changelog](packages/kit/CHANGELOG.md), released with `kit-vX.Y.Z` tags; it stays at
  0.3.0 for now. Spotcraft releases (`vX.Y.Z`) publish the image and the CLI, which pins the
  kit's exact version, and CI refuses one whose kit isn't on npm or changed since its tag.
  Apps no longer get a new kit version with every Spotcraft release.
- **Spotcraft runs on one server** ([ADR 0026](docs/decisions/0026-one-server.md)). The agent,
  the dashboard, Postgres and the monitoring share one Compose stack in `infra/server`, which
  replaces `infra/apps-server` and `infra/ops-server`. Docker networks replace the private
  network: hosted apps reach only Caddy and Postgres, and only the dashboard reaches the agent.
  Behind a Cloudflare Tunnel, Caddy trusts `CF-Connecting-IP` from cloudflared only and serves
  the dashboard only to it. The agent also reserves `dashboard`, `cloudflared`,
  `victoriametrics`, `vmagent` and `blackbox` as app names and refuses `DASHBOARD_DOMAIN` as an
  app host.
  `infra/hetzner` creates one server and no network; `infra/cloudflare` keeps one tunnel. Add an
  external uptime check on the dashboard's URL, since the monitoring now shares the server.
  **Breaking**, migration from two servers:
  1. In the `production` environment, add the variable `SERVER_HOST` (the apps server's public
     IP) and the secret `CLOUDFLARE_TUNNEL_TOKEN` (the value of `CLOUDFLARE_TUNNEL_TOKEN_APPS`).
  2. Run Deploy with the new version. The apps server now runs everything. The old dashboard on
     the ops server loses the agent here, so expect a few minutes without a dashboard; hosted
     apps keep running.
  3. Stop the ops server's stack (`docker compose down` in `/opt/spotcraft` there).
  4. Behind Cloudflare: `tofu plan` in `infra/cloudflare` must show the dashboard record moving
     to the `spotcraft-apps` tunnel, `spotcraft-ops` being destroyed, and **no replacement** of
     `spotcraft-apps`. Then `tofu apply`. Without Cloudflare: point the dashboard's A and AAAA
     records at the apps server.
  5. `tofu plan` in `infra/hetzner` must show the ops server and the private network being
     destroyed and no replacement of `spotcraft-apps`. The ops server has delete protection: set
     `protect_servers = false` for that one apply, then back to `true`.
  6. Remove `APPS_HOST`, `OPS_HOST`, `APPS_PRIVATE_IP`, `OPS_PRIVATE_IP`,
     `CLOUDFLARE_TUNNEL_TOKEN_APPS` and `CLOUDFLARE_TUNNEL_TOKEN_OPS`, trim `KNOWN_HOSTS` to the
     server's key, and remove the leftover `ufw allow from 10.0.0.0/16` rule on the server.
     The metrics history from the ops server isn't carried over.
- **Taking over a custom domain's DNS records is now an app setting**
  ([ADR 0022](docs/decisions/0022-takeover-setting.md)). `takeOver` is stored in `app.json`,
  returned by `GET /apps/:name` and sent in the `PUT` body. The dashboard's checkbox keeps its
  value, and while it is on every deploy may replace records Spotcraft didn't make.
  **Breaking (agent API):** the `?takeOver=true` query parameter is gone. Send
  `"takeOver": true` in the body instead. Existing apps start with it off.

## [0.3.0] - 2026-11-13

An address for every app, and Spotcraft behind Cloudflare if you want it
([ADR 0021](docs/decisions/0021-cloudflare-edge.md)). Nothing changes until you set the new
settings.

### Added

- **Default subdomains**: with the `APPS_DOMAIN` variable, every app is served at
  `<name>.<APPS_DOMAIN>`; the app's `domain` becomes an optional custom domain. The agent has
  `GET /settings`, and every app lists its `hostnames`.
- **`infra/cloudflare`**, an OpenTofu module: Cloudflare Tunnels for both servers, the wildcard
  and dashboard records, zone TLS settings, bot switches, a rate limit on `/login`, Access in
  front of the dashboard, and Cloudflare for SaaS for custom domains outside the account.
- **Tunnel mode** (`EDGE=cloudflare` with the `CLOUDFLARE_TUNNEL_TOKEN_APPS` and `_OPS` secrets):
  `cloudflared` runs on both servers, Caddy is published on loopback only, and the dashboard and
  apps are served over plain HTTP to the tunnel. `infra/hetzner` gains `edge = "cloudflare"` to
  close ports 80 and 443.
- **Custom domains through Cloudflare**: with the agent's `CLOUDFLARE_*` settings, a domain in the
  account gets a proxied CNAME to the tunnel, and any other domain a custom hostname. The dashboard
  shows each domain's status and the records still to add. `PUT /apps/:name?takeOver=true` replaces
  records Spotcraft didn't make.
- **Require sign-in**: `protected: true` puts an app behind Cloudflare Access with the owners'
  policy (`CLOUDFLARE_ACCESS_POLICY_ID`). Its uptime probe expects the Access sign-in redirect.

### Changed

- Caddy passes each visitor's address to apps and the dashboard as `X-Forwarded-For`, and trusts
  `CF-Connecting-IP` only from `CADDY_TRUSTED_PROXIES` (loopback unless behind the tunnel).
- The ops server gets `blackbox.yml` with the probe modules; the Deploy workflow copies it.
- The Deploy workflow's final check also accepts a redirect to Cloudflare Access.
- When the agent starts, it rewrites every app's Caddy site for the current `EDGE` and
  `APPS_DOMAIN` (protecting a protected app's new hosts first), so a mode switch reaches every
  app without redeploying each one.
- A failed deploy puts the domain's DNS back exactly as it was, including records a take-over
  replaced.
- An app's uptime averages all of its addresses, and "Reachable now" needs every address up.
- `dev` is now the default branch; `main` holds the released version. The `latest` image tag is
  published from `main`.
- Dependencies: Caddy 2.11.9, VictoriaMetrics and vmagent v1.156.0, Node 26.13.1 and refreshed
  distroless images, SvelteKit 3.2, better-auth 1.7.21, `@types/node` 26 (matching Node 26).
  TypeScript stays on 6 until `svelte-check` supports 7.

## [0.2.0] - 2026-11-08

Databases for hosted apps, and a backend kit that gives server-rendered apps guest accounts:
one Postgres on the apps server with a database per app, the `spotcraft dev` command to run
the same setup locally, and the dashboard to see and delete an app's users. **Before
deploying, add the `POSTGRES_AGENT_PASSWORD` secret** (see Changed).

### Added

- **Postgres** on the apps server (`postgres` service, Postgres 18), the base for databases for
  hosted apps. Reachable only inside Docker; the superuser only over the local socket.
- **App databases** in the agent's API: `database: true` gives an app its own Postgres role and
  database as `DATABASE_URL`. Removing an app keeps its database unless `?purge=true`. When
  the agent starts, it brings every app database up to date.
- **`spotcraft dev`** (`packages/cli`): the apps server's Postgres and app database setup on
  your machine, for local development (`start`, `stop`, `status`, `env --write`, `reset`,
  `migrate`).
- **npm packages**, published by CI on release tags with provenance: `@spotcraft/kit` and
  the CLI as `spotcraft` (`npx spotcraft dev start`). Their APIs join the public API
  ([ADR 0019](docs/decisions/0019-one-version-with-npm.md)).
- **Guide**: [Guest accounts with the backend kit](docs/guides/backend-kit.md), for a SvelteKit
  app locally and on Spotcraft.
- **Backend kit** (`packages/kit`): guest accounts for server-rendered apps on Better Auth,
  server-only (an httpOnly session cookie, no auth routes), with a guest limit per client
  address and a check of the `auth` schema version. `currentGuest` reads without creating,
  so apps create guests only when a visitor saves something, not for every page view or
  crawler.
- **App users**: for apps with a database, the dashboard lists their users (guests and
  registered, created, last seen) and deletes one with everything the app kept for them; the
  agent's API has `GET /apps/:name/users` and `DELETE /apps/:name/users/:id`.
- **Dashboard**: a Database checkbox when adding or editing an app, the database in the app's
  settings, and "Also delete its database" when removing it.

### Changed

- The Deploy workflow needs a new secret, `POSTGRES_AGENT_PASSWORD` (`openssl rand -hex 32`),
  on the `production` environment. Add it before deploying this version, or the deploy stops
  with "POSTGRES_AGENT_PASSWORD is empty". The apps server needs about 1 GB more memory.

## [0.1.0] - 2026-11-07

The first release: two servers, a deploy agent, a dashboard, and monitoring, enough to run a
handful of server-rendered apps from Docker Hub images behind HTTPS.

### Added

- **Apps server**: Caddy with automatic HTTPS in front of one container per app; `www.`
  redirects for root domains; HTTP/3.
- **Agent** (`spotcraft-agent` image): HTTP API on the private network to list, deploy, update,
  remove and read logs of apps. A deploy pulls the image, starts it with a health wait and
  reloads Caddy, and puts the previous version back if any step fails.
- **Dashboard** (`spotcraft-dashboard` image): password login; apps list with status and
  24-hour uptime; add and edit apps with tag suggestions from Docker Hub; per-app reachability,
  uptime, CPU, memory, response time and logs; redeploy and remove; a server page with host
  CPU, memory, disk, load and uptime.
- **Monitoring** on the ops server: VictoriaMetrics, vmagent, node-exporter and cAdvisor
  metrics, and HTTPS uptime probes of every app that follow the app list automatically.
- **Hetzner module** (OpenTofu): two ARM servers, a private network, a cloud firewall and a
  deploy key; optional daily backups of the apps server.
- **First-boot setup** (`infra/cloud-init.yaml`) for any Debian/Ubuntu VPS.
- **Deploy workflow**: deploys both servers at a published image tag from a GitHub
  environment, then checks the dashboard from outside.
- Multi-arch images (amd64 and arm64) on Docker Hub with provenance and SBOM.
- **Website** at spotcraft.dev (`spotcraft-site` image): a home page and the docs for each
  release, rendered from the repository's Markdown.
- The dashboard follows the system's dark mode.

### Security

- Hosted apps run without Linux capabilities, with `no-new-privileges`, a read-only root
  filesystem by default, and memory, CPU and process limits.
- Spotcraft's own services run without capabilities (Caddy keeps `NET_BIND_SERVICE`), read-only
  where possible, with limits and health checks; none runs privileged.
- The agent answers only the ops server's private address and requires a bearer token.
- The dashboard uses a scrypt password hash, an HMAC-signed `SameSite=Strict` session cookie, a
  per-address login lockout, a nonce-based CSP, HSTS and a 1 MB request limit.
- Real client addresses for IPv6 visitors (IPv6-enabled Docker networks).
- Distroless Node 26 images; CI fails on fixable HIGH/CRITICAL vulnerabilities; Dependabot
  proposes weekly updates. Base images and actions are pinned by digest and commit.
- Servers: key-only SSH as a `deploy` user with modern algorithms only, root login refused,
  two firewalls, automatic security updates.

[Unreleased]: https://github.com/kodentuzo/spotcraft/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/kodentuzo/spotcraft/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/kodentuzo/spotcraft/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/kodentuzo/spotcraft/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/kodentuzo/spotcraft/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/kodentuzo/spotcraft/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/kodentuzo/spotcraft/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/kodentuzo/spotcraft/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/kodentuzo/spotcraft/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kodentuzo/spotcraft/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kodentuzo/spotcraft/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kodentuzo/spotcraft/releases/tag/v0.1.0
