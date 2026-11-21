# Decisions

Architecture decision records, numbered in order. A changed decision gets a new record
that supersedes the old one; old records are never rewritten.

| #    | Decision                                                                                       | Status                                       |
| ---- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 0001 | [Apps and ops on two servers](0001-two-servers.md)                                             | superseded by 0026                           |
| 0002 | [A small agent deploys apps](0002-agent-control-path.md)                                       | accepted                                     |
| 0003 | [VictoriaMetrics and VictoriaLogs](0003-victoria-monitoring.md)                                | accepted                                     |
| 0004 | [Generic VPS bootstrap, optional Hetzner](0004-provisioning.md)                                | accepted, partly superseded by 0026          |
| 0005 | [One pnpm monorepo: SvelteKit and Fastify](0005-repo-and-stack.md)                             | accepted                                     |
| 0006 | [Shared UI package with shadcn-svelte](0006-shared-ui.md)                                      | accepted, partly superseded by 0033          |
| 0007 | [App state lives on the apps server; agent API](0007-app-state-on-apps-server.md)              | accepted                                     |
| 0008 | [Dashboard login with one admin password](0008-dashboard-login.md)                             | accepted, partly superseded by 0023          |
| 0009 | [Multi-arch images on Docker Hub, built by CI](0009-images-on-docker-hub.md)                   | accepted, partly superseded by 0025          |
| 0010 | [Hetzner ARM servers, deploy user only, one first-boot template](0010-hetzner-servers.md)      | accepted, partly superseded by 0026          |
| 0011 | [Spotcraft deploys itself with a manual GitHub workflow over SSH](0011-deploy-workflow.md)     | accepted, partly superseded by 0026          |
| 0012 | [Hardening from the v0.1.0 audit](0012-hardening-before-v0-1.md)                               | accepted                                     |
| 0013 | [One Semantic Version for the whole project](0013-one-version.md)                              | superseded by 0019                           |
| 0014 | [The website is static and hosted on Spotcraft itself](0014-website.md)                        | accepted, partly superseded by 0024          |
| 0015 | [One Postgres on the apps server, a database per app](0015-shared-postgres.md)                 | superseded by 0034                           |
| 0016 | [A server-only backend kit, starting with guest accounts](0016-backend-kit.md)                 | superseded by 0035                           |
| 0017 | [A local stack that matches the server](0017-local-stack.md)                                   | superseded by 0037                           |
| 0018 | [The dashboard lists and deletes an app's users](0018-user-management.md)                      | superseded by 0035                           |
| 0019 | [One version for the project, including its npm packages](0019-one-version-with-npm.md)        | accepted, partly superseded by 0027          |
| 0021 | [Apps get a default subdomain; Cloudflare can sit in front](0021-cloudflare-edge.md)           | accepted, partly superseded by 0022 and 0023 |
| 0022 | [Taking over a custom domain's DNS records is an app setting](0022-takeover-setting.md)        | accepted                                     |
| 0023 | [A Cloudflare Access sign-in also signs in to the dashboard](0023-access-sign-in.md)           | accepted                                     |
| 0024 | [The website is plain Astro, published on GitHub Pages](0024-website-on-pages.md)              | accepted, partly superseded by 0033, 0041    |
| 0025 | [One image runs the agent and the dashboard as two containers](0025-one-image.md)              | accepted                                     |
| 0026 | [Spotcraft runs on one server](0026-one-server.md)                                             | accepted                                     |
| 0027 | [The kit has its own version](0027-kit-version.md)                                             | superseded by 0036                           |
| 0028 | [Deploys start the new version next to the old one](0028-zero-downtime-deploys.md)             | accepted                                     |
| 0029 | [An app's CI deploys a new tag through a deploy hook](0029-deploy-hook.md)                     | accepted                                     |
| 0030 | [Nightly dumps of every app to a bucket, and Hetzner backups of the server](0030-backups.md)   | accepted, partly superseded by 0034          |
| 0031 | [The kit holds the server glue every app repeated](0031-kit-app-glue.md)                       | superseded by 0036                           |
| 0032 | [An older app starts on a database a newer one migrated](0032-rollback-on-a-newer-database.md) | accepted                                     |
| 0033 | [The theme and plain-CSS components come from spotstrap](0033-theme-from-spotstrap.md)         | superseded by 0041                           |
| 0034 | [Every app gets the same small contract, with no switches](0034-app-contract.md)               | accepted                                     |
| 0035 | [Each instance runs one user pool, starting with guests](0035-auth-pool.md)                    | accepted                                     |
| 0036 | [The kit becomes spotkit, outside this repository](0036-spotkit.md)                            | accepted                                     |
| 0037 | [Each repository gets its own local stack](0037-local-stack-per-repo.md)                       | accepted                                     |
| 0038 | [Every app gets usage numbers, collected by the platform with Umami](0038-analytics.md)        | accepted, partly superseded by 0040          |
| 0039 | [Deploys are recorded, and the dashboard fetches app icons](0039-app-status-at-a-glance.md)    | accepted                                     |
| 0040 | [The dashboard lists which users use an app](0040-admin-sees-app-users.md)                     | accepted                                     |
| 0041 | [All UI is shadcn-svelte, with its own theme](0041-all-ui-from-shadcn-svelte.md)               | accepted                                     |
