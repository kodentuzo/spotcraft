# spotcraft

The `spotcraft` command. For now it has one job: `spotcraft dev` runs, on your machine, the same
Postgres and app schema setup an app gets on a Spotcraft server
([ADR 0017](https://github.com/kodentuzo/spotcraft/blob/main/docs/decisions/0017-local-stack.md)). It needs Docker.

```bash
npm install --save-dev spotcraft   # same version as the Spotcraft you deploy to
npx spotcraft dev start            # start the local Postgres and set up this app's schema
npx spotcraft dev env --write      # add DATABASE_URL, DATABASE_SCHEMA, AUTH_SECRET to .env (if missing)
```

| Command             | What                                                                                |
| ------------------- | ----------------------------------------------------------------------------------- |
| `dev start`         | starts the local Postgres if needed, sets up this app's schema, prints its settings |
| `dev stop`          | stops the local Postgres; the data stays                                            |
| `dev status`        | whether it runs, and whether this app's schema exists                               |
| `dev env [--write]` | prints the variables below; `--write` adds missing ones to `.env`                   |
| `dev reset [--yes]` | deletes this app's schema and creates it empty again (asks first)                   |
| `dev migrate`       | brings this app's role settings up to date after upgrading the CLI                  |

Apps share one database, `apps`, as on the server
([ADR 0034](https://github.com/kodentuzo/spotcraft/blob/main/docs/decisions/0034-app-contract.md)).
Each gets its own schema and role, `app_<name>` with dashes as underscores, and these variables:
`DATABASE_URL` (the `apps` database, as the app's role), `DATABASE_SCHEMA` and `AUTH_SECRET`.
The schema starts empty, and the app creates its own tables.

An app set up by an older CLI keeps its own database, `app_<name>`, and gets only
`DATABASE_URL` to it; `dev reset` moves it to a schema. Apps on `@spotcraft/kit` need the kit's
`auth` schema, which a schema can't hold, so they stay on `spotcraft` 0.5 until they move to the
instance's user pool ([ADR 0035](https://github.com/kodentuzo/spotcraft/blob/main/docs/decisions/0035-auth-pool.md)).

The app name comes from `--name`, or from the `name` in `package.json` made into an app name
(`@acme/Blog_API` → `blog-api`).

## Same as the server

- **One Postgres for every app on the machine.** It's a Compose project, `spotcraft-dev`, with
  the data in the `spotcraft-dev_data` volume. Each app gets its own role and schema in `apps`,
  created by `spotcraft/provision`, the same code the agent uses. So one app can't read
  another's tables here either.
- **The same image and login rules** as the server: the pinned Postgres image, and the
  superuser only over the container's socket. **The same admin role**: `spotcraft_agent`, set up
  with the deploy script's SQL. Tests fail if the CLI's copies of the image, the rules or that
  SQL drift from `infra/`.
- **The same version**: the CLI's version matches the Spotcraft it deploys to (one version for
  the project).

## Local only

Postgres listens on `127.0.0.1:54340` only. The port isn't 54322, which Supabase uses. The
passwords are fixed (`local-<name>-password` for an app), so `DATABASE_URL` stays the same
across runs and in `.env`. That's fine for throwaway data on your own machine and nowhere else.
`AUTH_SECRET` is random; `env --write` keeps the one already in `.env`.

To remove everything: `docker compose -p spotcraft-dev down -v`.

## Developing

In the workspace, run it from source with `pnpm --filter spotcraft spotcraft dev …`. Note
that pnpm runs it in `packages/cli`, so pass `--name`. `pnpm --filter spotcraft build`
writes `dist/`: the `spotcraft` bin, and `spotcraft/provision`, which the agent imports. That
export is for Spotcraft itself, not for apps.
