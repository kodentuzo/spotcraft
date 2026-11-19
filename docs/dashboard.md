# Using the dashboard

The dashboard is where you add apps and look after them. It runs on your server at the
dashboard domain, behind its password or Cloudflare Access.

<picture>
  <source srcset="/screenshots/app-dark.webp" media="(prefers-color-scheme: dark)" />
  <img src="/screenshots/app-light.webp" alt="The app list: server memory, disk and backups at the top, then each app with its status, last deploy, uptime, memory and traffic." width="1280" height="800" />
</picture>

## Finding your way

- **The sidebar** has the dashboard's pages: Overview, Usage, Logs, Server, Domains, Backups,
  Users and Settings. At the top is your instance and its version; at the bottom, who is signed
  in (the Cloudflare Access email and its picture, or "Admin" for the password) and Log out.
- **The switcher**, at the top left, picks what the pages are about: **All apps**, or one app.
  Every page has both. With an app picked, the sidebar's links stay on that app, and picking
  another keeps you on the same page.
- **The address** says the same: `/usage` is every app, `/blog/usage` is the app `blog`.
- **Add app**, at the top right, adds an app.
- On a phone, the sidebar opens from the menu button.

## Overview

**All apps** (`/`): the server's memory and disk, whether backups are up to date, and a row per
app. Each row shows the app's status, its last deploy (or the one that failed, and which
version still runs), 24 hourly bars of uptime, its memory against its limit, and visitors over
7 days, or requests for an app without pages. Apps that need a look come first.

**One app** (`/blog`): Redeploy, Edit and Visit; anything wrong first (a failed deploy or
backup); then the deployment (status, version, when it was deployed, its addresses and limits),
its health (uptime, response time, CPU, memory) and its usage over 7 days.

## Usage

Visitors, page views and requests over the last 7 days, each with its change from the week
before. For all apps, one chart and a row per app; for one app, its new accounts too, then
where its visits come from: pages and hosts, referrers, countries, devices and browsers,
operating systems, custom events and app versions. Counted without cookies or anything that
identifies a visitor.

## Logs

For all apps, every app's latest lines merged by time. For one app, its last 200 lines. Reload
the page for newer ones.

## Server

For all apps, the server itself: CPU, memory, disk, load and uptime. For one app, its container
over the last day: CPU and memory against its limits, response time and uptime.

## Domains

Every address an app answers on: its subdomain of the apps domain, and its own domain with
whether it is live yet. If you manage that domain's DNS yourself, the records to add are listed
here. Change an app's domain from its Edit page.

## Backups

When backups are set up, every app's last backup: when, its size, and whether it failed or is
overdue. **Back up now** backs one up at once. See
[Backups and restoring](guides/backups.md) for setting them up and restoring.

## Users

Every app shares one user pool. For all apps: how many users and guests, accounts active today
and over 7 and 30 days, new accounts per day, app versions, then the users themselves. For one
app, the same for the users who have used it. **Delete** removes a user from the pool, and so
from every app, with what each app kept for them.

## Settings

For all apps, how this instance is set up: its domains, edge, DNS, Access, backups and user
pool. These come from the server's configuration and change with a deploy.

For one app: its settings, its deploy hook (see [Deploy from CI](guides/deploy-from-ci.md)), the
move into the user pool for an app made before it (see
[Moving an app into the user pool](guides/move-into-the-pool.md)), and **Remove**.

## Adding and changing an app

- **Add app** asks for a name, the image and tag, an optional custom domain, the port, memory
  and CPU limits, environment variables and whether visitors must sign in first.
  [Getting started](getting-started.md#7-add-your-first-app) explains each.
- **Edit** changes them and deploys. **Redeploy** pulls the same tag again, for an image that
  was pushed again under it.
- A deploy waits until the new version is healthy before it takes traffic. If it fails, you see
  why, and the version before keeps running.
- **Remove** stops the app and removes its settings and site. Its data is kept unless you
  choose to delete it too.
