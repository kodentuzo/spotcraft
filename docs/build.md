# Build apps

For the developers of the apps that run on Spotcraft: what an app gets from it, what it must do,
and how to work on it locally and ship it from CI. An app is a Docker image that answers HTTP on
one port; it can be written in anything.

1. [The app contract](contracts.md): the environment, the database, migrations, the paths
   Spotcraft serves for the app, its users and its analytics.
2. [Develop locally](guides/local-stack.md): `spotcraft dev` runs the same database, user pool
   and email on your machine, and fills in `.env`.
3. Guest accounts for SSR apps, with the backend kit: [SvelteKit](guides/backend-kit.md),
   [Nuxt](guides/kit-nuxt.md), [TanStack Start](guides/kit-tanstack-start.md).
4. [Deploy from CI](guides/deploy-from-ci.md): deploy each new image from the app's own
   workflow and wait until it is live.

Running the server? [Run Spotcraft](run.md) covers setting it up and the dashboard.
