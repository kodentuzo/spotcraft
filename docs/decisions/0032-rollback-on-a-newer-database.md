---
title: An older app starts on a database a newer one migrated
number: 32
status: accepted
implementation: done
date: 2026-11-18
supersedes: [31]
superseded_by: []
notes: "Partly supersedes 0031: migrateApp no longer stops when the database is newer than the app. Built in kit 0.4.1."
---

# An older app starts on a database a newer one migrated

## Context

ADR 0031 made `migrateApp` stop when the database has an app migration the app doesn't know.
The aim was to catch an image that is too old for its database.

But that is what a rollback is. Spotcraft rolls an app back by deploying its previous tag, and
apps' migrations only add (ADR 0028), so the previous version can run on the newer tables. With
the check, an older version exits at start, fails its health check, and the rollback never
happens. The rest of 0031 stands.

## Decision

- `migrateApp` runs nothing on a database that has migrations past the app's last one. The
  older app starts and uses the tables it knows.
- It still stops when an applied version now has another name, or when a migration is
  missing below the newest applied one.

## Consequences

- Rolling back across a migration works, as apps' docs already promise.
- A migration that drops or renames something would break the older version on rollback. That
  was already the rule ("migrations only add"); nothing enforces it.
