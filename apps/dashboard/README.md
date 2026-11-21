# @spotcraft/dashboard

SvelteKit app (adapter-node) on the Spotcraft server. One admin logs in with a password (or
through Cloudflare Access), then manages the apps through the agent and reads metrics from
VictoriaMetrics. It has no database: the agent's files are the app list.

## Screens

Signed-in pages share a sidebar (the instance's domain and version, the sections below, who is
signed in, and Log out) and a header bar (a switcher for the app the page is about, the section's title, Add app).
The shell is `@spotcraft/ui`'s Sidebar (`src/lib/components/AppSidebar.svelte`), with lucide
icons; the header's button hides it, and on a phone it opens as a sheet. The switcher is a
dropdown menu (`AppSwitcher.svelte`).

Every section has two scopes, chosen in the switcher: every app (`/usage`) or one, the app
first (`/<app>/usage`). Sidebar links keep the app picked; the switcher keeps the section. An
app can't take a page's name: the agent reserves them.

| Section  | Every app                                                                                                                                     | One app                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overview | `/`: apps running, server memory and disk, backups; a row per app with status, last deploy, uptime, memory                                    | `/<app>`: header (Redeploy, Edit, Visit), failures first, the deployment (status, version, when deployed, addresses, limits), health and usage totals  |
| Usage    | `/usage`: all apps' visitors, page views and requests over 7 days, then a row per app                                                         | `/<app>/usage`: a 7-day chart (visitors, page views, new accounts, requests), then pages, referrers, countries, devices, systems, events, app versions |
| Logs     | `/logs`: every app's latest lines merged by time                                                                                              | `/<app>/logs`: the last 200 lines                                                                                                                      |
| Server   | `/server`: the server's CPU, memory, disk, load, uptime                                                                                       | `/<app>/server`: the container's CPU and memory against its limits, response time and uptime over 24 hours                                             |
| Domains  | `/domains`: every address of every app, with DNS status and records                                                                           | `/<app>/domains`: the app's addresses                                                                                                                  |
| Backups  | `/backups`: every app's last backup, with Back up now (with backups)                                                                          | `/<app>/backups`: the last backup in detail, Back up now, Restore from a backup in the bucket                                                          |
| Users    | `/users`: users and guests, accounts active today, 7 and 30 days, new per day, app versions; then the pool's users, newest first, with Delete | `/<app>/users`: the same page for the users with a session on the app ([ADR 0040](../../docs/decisions/0040-admin-sees-app-users.md)), last seen there |
| Settings | `/settings`: how the instance is set up (domains, edge, DNS, Access, backups, user pool, version)                                             | `/<app>/settings`: its settings, deploy hook, own database, Remove                                                                                     |

Old links redirect: `/apps/<app>` to `/<app>` (and `?tab=usage` to `/<app>/usage`),
`/apps/<app>/edit` to `/<app>/edit`, `/apps/new` to `/new`, `/logs?app=<app>` to
`/<app>/logs`.

| Path                  | What                                                                                                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`              | password login (5 failures per client in 15 minutes lock it out; IPv6 counts per /64)                                                                                                                                                                       |
| `/new`                | add an app: name, image, tag (Docker Hub suggestions), custom domain, port, limits, env, sign-in                                                                                                                                                            |
| `/<app>/edit`         | change settings and deploy                                                                                                                                                                                                                                  |
| `/<app>/icon`         | the app's icon for its tile, fetched from its site ([ADR 0039](../../docs/decisions/0039-app-status-at-a-glance.md)): touch icon, then favicon; raster only, no redirects, 256 KB; kept an hour (a miss five minutes) per app and `?host=`; 404 without one |
| `/hooks/deploy/<app>` | the deploy hook for the app's CI, no sign-in: POST a tag, GET how it went ([guide](../../docs/guides/deploy-from-ci.md))                                                                                                                                    |

**Database** gives the app its own Postgres database on the server, as `DATABASE_URL`
([ADR 0015](../../docs/decisions/0015-shared-postgres.md)). The form refuses an own
`DATABASE_URL` while it is ticked. Removing such an app keeps its database unless "Also delete
its database" is ticked in the Remove dialog. If that delete fails after the app is gone, the
error page says so.

The sidebar shows the running Spotcraft version (from the dashboard's `package.json`, which
carries the project's version), linked to its release notes. It isn't shown before login.

A failed deploy shows the agent's error and command output; the previous version keeps
running. Metrics are optional: without VictoriaMetrics the pages show "No data yet".

Each time the app list is read or changed, the dashboard writes `PROBES_FILE`: one HTTPS
uptime-probe target per app, which vmagent reads (`file_sd_configs`).

## Settings

Checked when the server starts (`src/env.ts`); a missing or invalid value stops it with a
message naming the variable.

| Env                       | Default                                | Meaning                                                                            |
| ------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| `AGENT_URL`               | —                                      | e.g. `http://agent:4000`                                                           |
| `AGENT_TOKEN`             | —                                      | same token as the agent, 32+ characters                                            |
| `DASHBOARD_PASSWORD_HASH` | —                                      | from the `hash-password` script                                                    |
| `SESSION_SECRET`          | —                                      | 32+ characters; changing it logs everyone out                                      |
| `VICTORIAMETRICS_URL`     | `http://victoriametrics:8428`          | metrics query API                                                                  |
| `PROBES_FILE`             | empty (Compose: `/probes/probes.json`) | where to write probe targets                                                       |
| `CF_ACCESS_TEAM_DOMAIN`   | empty                                  | `<team>.cloudflareaccess.com`; with the next, an Access sign-in skips the password |
| `CF_ACCESS_AUD`           | empty                                  | the dashboard Access application's AUD tag; set both or neither                    |

It runs from the `spotcraft` image (the root `Dockerfile`, shared with the agent; Compose starts
it with `working_dir: /app/dashboard` and `command: ["build"]`). Compose also sets `PORT=3000`,
`PROBES_FILE=/probes/probes.json` and the adapter-node proxy settings for running behind Caddy:
`PROTOCOL_HEADER=x-forwarded-proto`, `ADDRESS_HEADER=X-Forwarded-For`, `XFF_DEPTH=1`.

```sh
pnpm --filter @spotcraft/dashboard hash-password   # prints DASHBOARD_PASSWORD_HASH (asks without echo)
pnpm --filter @spotcraft/dashboard build           # output in build/, no runtime node_modules needed
pnpm --filter @spotcraft/dashboard typecheck
pnpm --filter @spotcraft/dashboard test            # node:test, test/*.test.ts
docker build .                                     # the spotcraft image, from the repository root
```

## Security

- App routes are `/[name=name]/…`: the name must match the agent's rule and not be one of its
  reserved names (`src/params.ts`), and agent calls encode it.
- Every route but `/login` and `/hooks/deploy/<name>` needs a session or a Cloudflare Access sign-in;
  `/api/*` answers 401 instead of redirecting.
- **The deploy hook** (`/hooks/deploy/<name>`, [ADR 0029](../../docs/decisions/0029-deploy-hook.md))
  is for an app's CI. It takes the app's hook token as `Authorization: Bearer`, and JSON only, so a
  browser can't post to it cross-site without a preflight. The agent checks the token; the
  dashboard only relays it. The app page shows a new token once.
- **Access sign-in** (both `CF_ACCESS_*` set, [ADR 0023](../../docs/decisions/0023-access-sign-in.md)):
  a valid `Cf-Access-Jwt-Assertion` header counts as signed in. It must be signed with one of the
  team's published keys (cached, fetched from `/cdn-cgi/access/certs`), name the team as issuer and
  this app's AUD as audience, and carry an email, which the header shows. The `CF_Authorization`
  cookie alone doesn't count. Log out also ends the Access sign-in (`/cdn-cgi/access/logout`) and
  returns to the dashboard, where Access asks for the sign-in again; the CSP's `form-action`
  allows `https://*.cloudflareaccess.com` for that redirect. If
  the keys can't be fetched, the dashboard logs it and the password login still works.
- Session cookie: `httpOnly`, `SameSite=Strict`, HMAC-signed with an expiry (7 days).
- Form posts get SvelteKit's origin check; pages send a nonce-based CSP, `X-Frame-Options: DENY`
  and `Cache-Control: no-store`, except app icons (`private, max-age=3600`).
- The sidebar shows who is signed in: the Access email and its Gravatar, or "Admin" for the
  password. The CSP allows images from `https://gravatar.com` for that alone; the picture is
  asked for by the SHA-256 of the email, never the email, with no referrer.
- App settings are validated with the agent's own rules (`@spotcraft/agent/app-spec`).
