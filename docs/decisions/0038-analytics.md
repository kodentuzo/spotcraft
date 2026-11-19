---
title: Every app gets usage numbers, collected by the platform with Umami
number: 38
status: accepted
implementation: skeleton
date: 2026-11-19
supersedes: []
superseded_by: []
notes: "Fills in the analytics that ADR 0034 lists among what Spotcraft does. Built: Umami 3.4.1 on the server and in spotcraft dev, with its own database and role and nightly dumps. Found while building: TRACKER_SCRIPT_NAME and COLLECT_API_ENDPOINT serve the tracker and the collect endpoint at /_spotcraft/s.js and /_spotcraft/e, and Umami rewrites its script to send there, so its container is not read-only. It uses about 360 MB once started. Its bot filter drops Android's default User-Agent (okhttp), so native clients send a browser-style one. It starts with the default admin account, which the agent must replace. To build: the routes, the website per app, usage in the dashboard, the client package. Still to check: whether it prunes old events; that Better Auth 1.7's session hooks see the request."
---

# Every app gets usage numbers, collected by the platform with Umami

## Context

ADR 0034 lists analytics among what Spotcraft does for every app, and reserves
`/_spotcraft/s.js` and `/_spotcraft/e` for it. Today an app's page shows only its container's
CPU and memory and the uptime probe. Nothing says how many people use an app.

Apps on Spotcraft aren't only websites. Some are APIs, whose users are an Expo app on phones;
some are desktop apps built with Electron. A website script counts page views, but nothing for
those. Asking every app to wire up analytics itself would mean the same change in every
repository, and again for every later feature.

Some apps promise their users no tracking. Whatever Spotcraft collects must hold no ids or
personal data, set no cookies, and be easy to turn off.

## Decision

- **Umami, one per instance**, self-hosted with its own database in the instance's Postgres. It
  is cookieless, stores no IPs (it hashes them with a salt that rotates), and is light enough
  for a small server. Nothing goes to an outside service.
- **One Umami "website" per app**, which is Umami's name for the bucket its events go into. The
  agent creates it when the app is made, named after the app, and deletes it with the app and
  its numbers. Nobody creates one by hand or copies an id into an app.
- **The platform collects what it can, with no change to the app:**
  - **Page views:** Caddy inserts
    `<script defer src="/_spotcraft/s.js" data-website-id="<the app's id>"></script>` before
    `</head>` in the app's HTML responses. The script is first-party, so `script-src 'self'`
    allows it.
  - **Requests:** Caddy's per-host metrics give requests, the 5xx rate and p95 latency per app.
    That is what covers APIs.
  - **Accounts:** the pool records on each session the host it was made or renewed on, so the
    agent can count new guests per day and active accounts per app. An Expo app that reaches the
    pool through its API's domain is counted under that API.
- **Clients that can't be injected** (native and desktop apps) use one package,
  `@kodentuzo/spotkit/client`. It reads the app's settings from `/_spotcraft/config.json`, sends
  screens and events to `/_spotcraft/e`, and adds a `Spotcraft-Client: <platform>/<version>`
  header to the app's pool requests so the pool can count platforms and versions. An app adds it
  once; new metrics arrive as package updates.
- **Paths**, all under `/_spotcraft/` on every app domain: `s.js` (Umami's tracker), `e` (its
  collect endpoint), `config.json` (the app's analytics id and whether analytics is on) and
  `privacy` (what is counted and how to opt out).
- **One switch, Analytics on or off, on by default.** It is where apps really differ (ADR 0034):
  an app with a nonce-only CSP, or one that must not count. Off removes the injection and makes
  `config.json` say so, and the package then sends nothing.
- **Privacy rules:**
  - no ids, no personal data and no cookies in anything collected; the package refuses id-like
    keys;
  - the dashboard shows counts only, never ids;
  - Umami keeps raw events for 13 months, and request metrics follow VictoriaMetrics' 90 days;
  - `/_spotcraft/privacy` describes it on every app domain, with an opt-out switch for the
    browser, and native apps show the package's opt-out.
- **The dashboard** shows each app's usage: Umami's visitors and pages or screens, the pool's
  account counts, the platforms and versions, and the request metrics. Umami's own interface
  isn't exposed.

## Consequences

- A website, an API or an Expo app that uses the pool gets numbers on deploy, with no change to
  its repository.
- Native and desktop apps need the package once. After that, updates bring new features.
- Caddy needs the `replace-response` module, so Spotcraft builds its own pinned Caddy image.
  Rewriting HTML means Caddy asks apps for uncompressed responses and compresses them itself.
- Umami adds a service and a database to every instance, with its own backups.
- Visitor counts for native apps are approximate: Umami tells visitors apart by a hash of IP and
  User-Agent, and phones change IP. The dashboard says so.
- Apps that promise "no tracking" reword that promise once, because their usage is now counted,
  anonymously and with an opt-out.
- The contract grows by three paths and one header. Like any contract change, it changes rarely.
