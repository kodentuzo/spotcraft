# The app contract

> **Planned.** This is the contract decided in ADRs
> [0034](decisions/0034-app-contract.md), [0035](decisions/0035-auth-pool.md),
> [0036](decisions/0036-spotkit.md) and [0037](decisions/0037-local-stack-per-repo.md). It is
> being built; until then, apps work as described in the guides.

Everything an app gets from Spotcraft, and everything Spotcraft expects from it. An app that
follows this page runs anywhere that provides the same values. [spotkit](https://github.com/kodentuzo/spotkit)
implements the app side, but nothing here needs it.

## `spotcraft.json`

One per deployable folder, next to its `package.json` or `Dockerfile`:

```json
{ "name": "lifts-api", "migrate": "pnpm db:migrate" }
```

- `name` is the app's slug: lowercase letters, digits and dashes. It names the app's database
  (`app_<slug>`, with dashes as underscores) and its subdomain. It is the app's identity:
  renaming means a new app.
- `migrate` is optional. `spotcraft dev` runs it after creating the database.

## Environment variables

Spotcraft sets these for every container app. The app's own env can't override them.

| Variable         | Value                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| `PORT`           | The port to listen on.                                                     |
| `PUBLIC_URL`     | The app's public address, e.g. `https://librelifts.app`.                   |
| `APP_NAME`       | The slug.                                                                  |
| `APP_RELEASE`    | The image tag that is running.                                             |
| `APP_SECRET`     | 32 random bytes, base64, for the app's own signing. Stable across deploys. |
| `DATABASE_URL`   | The app's own Postgres database.                                           |
| `AUTH_URL`       | The user pool, through the app's domain: `<PUBLIC_URL>/_spotcraft/auth`.   |
| `AUTH_ISSUER`    | The `iss` every token from the pool carries.                               |
| `AUTH_JWKS_URL`  | The pool's public keys.                                                    |
| `WEBHOOK_SECRET` | The key that signs webhooks to this app.                                   |
| `SMTP_URL`       | Coming with instance SMTP: `smtp://user:pass@host:587`.                    |
| `MAIL_FROM`      | Coming with instance SMTP: the sender address.                             |

Locally, `spotcraft dev` writes the same names to `.env`.

## Database

- One database per app, `app_<slug>`, owned by the role `app_<slug>`. The app owns everything in
  it, including its migrations.
- At most 20 connections, and statements stop after 30 seconds.
- The app can't reach other databases, including the pool's.

## Paths

`/_spotcraft/*` on every app domain belongs to the platform:

| Path                       | Handled by  | What                                   |
| -------------------------- | ----------- | -------------------------------------- |
| `/_spotcraft/auth/*`       | the pool    | Guests and sessions (Better Auth API). |
| `POST /_spotcraft/webhook` | **the app** | Signed events from the platform.       |

Analytics will add `/_spotcraft/s.js` and `/_spotcraft/e`.

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
- **Claims:** `sub` (the user id, a UUID), `is_anonymous`, `iss`, `iat`, `exp`.
- **App data** keeps the user as `user_id uuid`, with no foreign key: the user lives in another
  database.

## Webhook

`POST /_spotcraft/webhook` with a JSON body:

```json
{
  "id": "<event uuid>",
  "type": "user.deleted",
  "time": "2026-11-19T10:00:00Z",
  "sub": "<user uuid>"
}
```

- Header `Spotcraft-Signature: t=<unix seconds>,v1=<hex>`, where `v1` is HMAC-SHA256 of
  `<t>.<raw body>` with `WEBHOOK_SECRET`. Reject a bad signature and a `t` more than 5 minutes
  old.
- Answer 2xx once handled. Anything else is retried with backoff for up to a day.
- The same event can arrive twice, so handling it must be safe to repeat (use `id`).
- An unknown `type` gets 2xx and is ignored.

| Type           | The app should                        |
| -------------- | ------------------------------------- |
| `user.deleted` | Delete or anonymise that user's rows. |

## What the app does

- **Health:** a `HEALTHCHECK` in the image, or `GET /health` answering 200 when ready.
- **Migrations:** run at start, under an advisory lock. Only add, since two versions run side by
  side during a deploy.
- **Stop:** finish within 30 seconds of SIGTERM.
- **Logs:** to stdout, ideally JSON lines with `level`, `msg` and `time`.
