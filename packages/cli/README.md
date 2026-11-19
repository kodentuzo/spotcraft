# @kodentuzo/spotcraft

The `spotcraft` command. `spotcraft dev` runs a local stack that matches a Spotcraft server, one
per repository ([ADR 0037](https://github.com/kodentuzo/spotcraft/blob/main/docs/decisions/0037-local-stack-per-repo.md)):
Postgres set up as on the server, the user pool, and Mailpit to catch email. It needs Docker.

```bash
npm install --save-dev @kodentuzo/spotcraft   # same version as the Spotcraft you deploy to
npx spotcraft dev                             # start, set up this app, fill .env, migrate
```

It replaces the `spotcraft` package, which apps on `@spotcraft/kit` keep at 0.5 until they move
to the user pool.

| Command                | What                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `dev`                  | starts the stack if needed, sets up this app's schema, adds missing settings to `.env`, runs `migrate` |
| `dev env [--write]`    | prints this app's settings; `--write` adds missing ones to `.env`                                      |
| `dev db reset [--yes]` | deletes everything in this app's schema (asks first), then runs `migrate`                              |
| `dev migrate`          | runs `migrate` from `spotcraft.json` with this app's settings                                          |
| `dev status`           | whether the stack runs, its addresses, and this app's schema                                           |
| `dev stop`             | stops the stack; the data stays                                                                        |
| `dev ls`               | every repository's stack on this machine                                                               |

## The app

The app's name comes from `--name`, else `name` in `spotcraft.json`, else the `name` in
`package.json` made into an app name (`@acme/Blog_API` → `blog-api`). `spotcraft.json` sits in
the deployable's folder:

```json
{ "name": "lifts-api", "migrate": "pnpm db:migrate" }
```

`migrate` runs through the shell in that folder, with the app's settings; values in `.env` win.
On the server, the image's `dev.spotcraft.migrate` label does that job instead
([the contract](https://github.com/kodentuzo/spotcraft/blob/main/docs/contracts.md)).

`.env` gets the names the server uses, pointing at the local stack: `DATABASE_URL`,
`DATABASE_SCHEMA`, `APP_NAME`, `APP_SECRET` (random, kept), `PUBLIC_URL`
(`http://localhost:3000`; change it to your dev server's), `AUTH_URL`, `AUTH_ISSUER`,
`AUTH_JWKS_URL`, `SMTP_URL` and `MAIL_FROM`. Existing lines are never changed.

An app set up by the old `spotcraft` CLI keeps its own database and gets only `DATABASE_URL`
and `AUTH_SECRET`; `dev db reset` moves it to a schema.

## The stack

- **One per repository**, found from the folder you run it in: the nearest folder up with
  `.git` or `pnpm-workspace.yaml`. Every deployable in a monorepo shares it, so their tables can
  point at the same local users. It is the Compose project `spotcraft-dev-<repo folder>`, with
  its data in its own volume.
- **Ports** are picked from the free ones on the first run and kept in `.spotcraft/dev.json`
  at the repository's root, so `.env` stays valid. `.spotcraft/` ignores itself in git.
- **Postgres:** the server's pinned image and login rules, the same roles and grants (the deploy
  script's SQL), and the same provisioning code as the agent (`@kodentuzo/spotcraft/provision`).
  Every app has its own schema and role in the `apps` database. Tests fail if the copies of the
  image, the rules or that SQL drift from `infra/`.
- **The user pool:** the `spotcraft` image of this CLI's version (`SPOTCRAFT_DEV_IMAGE`
  overrides it, e.g. with a local build), over plain HTTP. It trusts any
  `http://localhost:<port>` and `http://127.0.0.1:<port>` origin, where dev servers run. Its
  cookies are host-only, and browsers send `localhost` cookies to every port, so an app at
  `localhost:3000` and the pool at its own port share the session.
- **Mailpit** catches every email sent to `SMTP_URL`; its inbox is at the address `dev status`
  shows.

Everything listens on `127.0.0.1` only. The passwords are fixed (`local-<name>-password` for an
app), which is fine for throwaway data on your own machine and nowhere else. To remove a stack
and its data: `docker compose -p spotcraft-dev-<repo> down -v`.

## Developing

In the workspace, run it from source with
`node --conditions=spotcraft-source packages/cli/src/cli.ts dev …` from an app's folder. pnpm
selects this package by folder (`--filter ./packages/cli`), as `spotcraft` is also the
workspace root's name. `pnpm --filter ./packages/cli build` writes `dist/`: the `spotcraft` bin,
and `@kodentuzo/spotcraft/provision`, which the agent imports. That export is for Spotcraft
itself, not for apps.
