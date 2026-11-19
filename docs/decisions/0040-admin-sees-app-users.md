---
title: The dashboard lists which users use an app
number: 40
status: accepted
implementation: done
date: 2026-11-19
supersedes: [38]
superseded_by: []
notes: "Partly supersedes 0038: its rule that the dashboard shows counts only, never ids, for the Users page alone. Built: GET /pool/users?app=<name> (users with a session on the app's hosts, last seen there) and GET /pool/usage (the whole pool's account counts); one Users page in the dashboard for the pool and for each app."
---

# The dashboard lists which users use an app

## Context

ADR 0038 says the dashboard shows usage as counts only, never ids. The dashboard's Users page
(ADR 0035) already lists every user of the pool by id, and deletes them; an app's own Users page
showed only counts. The two pages should be the same page, for the pool and for one app.

The pool already records the host each session was made or renewed on (0038), so it knows which
users used an app. Nothing new needs collecting.

## Decision

- **An app's Users page lists its users**: the pool's users with a session on the app's
  addresses, with when they were last seen there. This replaces 0038's "the dashboard shows
  counts only, never ids" for that page alone.
- **Both Users pages are the same page**: users and guests, accounts active today, in 7 and in
  30 days, new accounts per day, app versions, then the list with Delete. For the pool the
  numbers count every session; for an app, the sessions on its addresses.
- Deleting a user from either page removes them from the pool, and so from every app.
- Everything else in 0038 stands: nothing more is collected, usage numbers elsewhere are counts
  only, and apps' privacy pages need no change.

## Consequences

- Whoever can sign in to the dashboard (its password or Cloudflare Access) can see which users
  use which app. That person could already list every user and read every app's database.
- The agent's `GET /pool/users` takes `?app=`, and `GET /pool/usage` gives the pool's counts.
