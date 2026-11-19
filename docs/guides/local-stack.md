# Develop locally

`spotcraft dev` runs, on your machine, what an app gets on the server: Postgres set up the same
way, the user pool, and Mailpit to catch email. It sets up the app's schema, writes its
settings to `.env` under the names the server uses, and runs its migrations
([ADR 0037](../decisions/0037-local-stack-per-repo.md)). It needs Docker.

## Start

In the app's folder:

```bash
npm install --save-dev @kodentuzo/spotcraft   # the same version as the Spotcraft you deploy to
npx spotcraft dev
```

The first run starts the stack, makes the app's schema and role, adds the missing settings to
`.env` and runs `migrate`. Later runs do only what is missing. Existing lines in `.env` are never
changed.

## Tell it about the app

`spotcraft.json`, next to the app's `package.json`, names the app and its migrations:

```json
{ "name": "lifts-api", "migrate": "pnpm db:migrate" }
```

Without it, the name comes from `package.json` (`@acme/Blog_API` becomes `blog-api`). On the
server, the image's `dev.spotcraft.migrate` label runs the migrations instead
([the contract](../contracts.md#migrations)).

## What `.env` gets

The names the server uses, pointing at your machine: `DATABASE_URL`, `DATABASE_SCHEMA`,
`APP_NAME`, `APP_SECRET`, `PUBLIC_URL` (`http://localhost:3000`: change it to your dev
server's), `AUTH_URL`, `AUTH_ISSUER`, `AUTH_JWKS_URL`, `SMTP_URL` and `MAIL_FROM`. The same code
then runs locally and on the server.

## Every day

| Command                      | What                                                        |
| ---------------------------- | ----------------------------------------------------------- |
| `npx spotcraft dev`          | start if needed, set up what is missing, migrate            |
| `npx spotcraft dev migrate`  | run the migrations again                                    |
| `npx spotcraft dev db reset` | empty the app's schema (asks first), then migrate           |
| `npx spotcraft dev status`   | whether it runs, its addresses (Mailpit's inbox among them) |
| `npx spotcraft dev stop`     | stop it; the data stays                                     |
| `npx spotcraft dev ls`       | every stack on this machine                                 |

## Good to know

- **One stack per repository**, so every app in a monorepo shares one database and user pool,
  as they would on one server. Two checkouts of the same repository get their own.
- **Sign-in works across ports**: the user pool trusts any `localhost` origin, and browsers
  send `localhost` cookies to every port.
- **Local only**: everything listens on `127.0.0.1`, with fixed passwords. Fine for throwaway
  data on your machine, nowhere else.

The [CLI's README](../../packages/cli/README.md) has the details: how the stack is found, its
ports, and removing one with its data.
