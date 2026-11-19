---
title: Deploys are recorded, and the dashboard fetches app icons
number: 39
status: accepted
implementation: done
date: 2026-11-19
supersedes: []
superseded_by: []
notes: "Built: deploy.json and lastDeploy in the agent; the app list and app page that show them; /apps/:name/icon in the dashboard with a raster-only, redirect-free, 256 KB, streamed fetch, cached an hour (a miss five minutes), keyed by app and host; the hooks' no-store stays on everything but that `private` response; usage `?brief=true` for the list."
---

# Deploys are recorded, and the dashboard fetches app icons

## Context

The dashboard's app list and app page answer two questions first: is the app up, and what is
deployed, and did that work. Uptime comes from the probes. But the agent kept no record of
deploys: Docker's "Up 3 hours" restarts with the container, so it can't say when an app was
deployed or that a deploy failed.

Rows and pages also show each app's icon, which only the app's own site has. The dashboard's CSP
allows images from itself alone (`img-src 'self'`), and everything it serves is `no-store`.

## Decision

- **The agent records each app's last deploy** in `apps/<name>/deploy.json`, next to
  `app.json`: when it finished, the tag, ok or the error, and the last tag and time that worked
  when it failed. Every deploy writes it, from the dashboard, the deploy hook or a move. It is
  returned as `lastDeploy` with the app, read-only: the agent refuses it in a `PUT`, like any
  unknown field, and the dashboard leaves it out when it sends settings back.
- **The dashboard fetches app icons itself**, at `/apps/:name/icon`, rather than the browser
  loading them from the app's site. It asks the host the agent reports (never one from the
  request) for `/apple-touch-icon.png`, then `/favicon.ico`, over HTTPS:
  - raster types only (PNG, ICO, JPEG, WebP); an SVG from the dashboard's own origin could run
    script if opened;
  - no redirects, so an app can't send the dashboard to another address;
  - at most 256 KB, read as a stream and cut off past it, within 3 seconds;
  - nothing for apps behind Access, whose sites answer with a sign-in page.

  Icons are kept in memory for an hour and a miss for five minutes, keyed by app and host. The
  response is `Cache-Control: private, max-age=3600`, the only one the hooks leave cached.
- **The app list asks for usage totals only** (`?brief=true`): one call to Umami per app, not
  one per breakdown.

## Consequences

- The list and the app page say what is deployed, since when, and whether the last deploy
  failed. Apps show it from their next deploy on.
- The CSP stays `img-src 'self'`. In exchange the dashboard makes outbound HTTPS requests to
  the apps' public addresses, at most one per app and host an hour.
- A new icon on a site shows within the hour; a new domain shows its icon at once.
- `deploy.json` is not backed up: it describes the server, not the app.
