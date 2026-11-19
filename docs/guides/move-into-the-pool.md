# Moving an app into the user pool

Apps made before [ADR 0034](../decisions/0034-app-contract.md) have their own database, with
their guests in its `auth` schema through `@spotcraft/kit`. This guide moves one into its
schema in the instance database, and its guests into the user pool
([ADR 0035](../decisions/0035-auth-pool.md)). Guests keep their cookies and their data.

It takes a new version of the app, made for the schema and the pool, and one click in the
dashboard.

## 1. Change the app

- **Drop `@spotcraft/kit`** for [`@kodentuzo/spotkit`](https://github.com/kodentuzo/spotkit).
  On the server, `spotkit().user(request)` says who the visitor is: it reads the pool's
  session cookie, which the browser sends to the app's own domain.
- **Make guests in the browser**, with Better Auth's client pointed at
  `/_spotcraft/auth`, before the visitor's first save. The kit made them on the server; the pool
  limits new guests per visitor's address, so the browser has to ask.
- **Put the tables in the app's schema** by name, `app_<slug>`, as in
  [the contract](../contracts.md#database). Reference `auth.users` from a file drizzle-kit
  doesn't read.
- **Start the migrations again** from one that creates today's tables in the schema. The old
  ones stay with the old database. Keep the migrator's table in the schema too.
- **Let the server run them:** add a `dev.spotcraft.migrate` label to the image, and drop
  anything that migrates at startup.
- **Answer `GET /health`**, or keep the image's `HEALTHCHECK`.
- **Keep `AUTH_SECRET`** in the app's env in the dashboard for now: the move needs it.

Try it with `spotcraft dev` from
[`@kodentuzo/spotcraft`](../../packages/cli/README.md), which gives the app a schema, the pool and
`.env`. Then build and push the image.

## 2. Move it

On the app's page in the dashboard, under **Own database**, enter the new version's tag and
press **Move**. Pick a quiet moment: what the old version writes after the copy stays behind.

The agent:

1. backs the app up, if backups are set up;
2. deploys the new version, with its schema set up and its migrations run;
3. copies the kit's guests and their live sessions into the pool, with the same ids and
   tokens, and the app's `AUTH_SECRET` into the pool's list of former secrets;
4. copies the rows of every table the migrations made and left empty, matching tables and
   columns by name;
5. starts the new version, as any deploy.

The page then says how many guests, sessions and rows came along. If any step fails, nothing
changes for visitors: the old version keeps running on its own database, and the new schema
is dropped. Fix the cause and press **Move** again.

## 3. What happens to cookies

The kit signed each guest's session cookie with the app's `AUTH_SECRET`. The pool signs with
its own, so it would reject those cookies. Instead, it checks them against the former secrets
too, re-signs a match with its own, and sends the browser the new cookie. The cookie's name
doesn't change. A guest who comes back keeps the same id, and every row that points at it.

## 4. Afterwards

- Remove `AUTH_SECRET` from the app's env: the pool keeps its own copy.
- The old database stays, unused. Once you're sure, drop it as `postgres` on the server:

  ```bash
  docker exec spotcraft-apps-postgres-1 psql -U postgres -c 'DROP DATABASE app_<slug>'
  ```

  Backups now dump the app's schema; older backups still hold the old database.
