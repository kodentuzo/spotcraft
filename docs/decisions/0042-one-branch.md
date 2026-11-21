---
title: One long-lived branch, main; a tag is a release
number: 42
status: accepted
implementation: done
date: 2026-11-21
supersedes: [9, 24]
superseded_by: []
notes: "CI checks branch names, rulesets protect main and the release tags, the website builds from tags."
---

# One long-lived branch, main; a tag is a release

## Context

The repository had two long-lived branches: `dev`, the default, where pull requests went, and
`main`, which held production. Every release took a release branch into `main` and then a pull
request merging `main` back into `dev`, so 0.8.2 needed four merges for one change set. The two
branches drifted apart in history even when their trees were the same, and the push rules,
skills and docs all had to name both.

Releases are already signed version tags, and deploying is already a separate, manual step. The
owner's Sokobanko works with `main` alone.

This record replaces two rules that assumed `main` held only released code:
[ADR 0009](0009-images-on-docker-hub.md)'s `main` → `latest` image tag, and
[ADR 0024](0024-website-on-pages.md)'s website deployed on every push to `main`. The rest of
both records stands.

## Decision

- `main` is the only long-lived branch and the default branch. Work happens on short-lived
  branches cut from `origin/main`, named `feature/<name>`, `bugfix/<name>` or `chore/<name>`
  (lowercase letters, digits, dots, hyphens), and merges back through a pull request.
- Pull requests merge with a merge commit only; squash and rebase are off. Branches are deleted
  after merging.
- The `branch-name` check (its own workflow, so it re-runs when a pull request is retargeted)
  fails a pull request that doesn't target `main` or whose branch doesn't follow the names. Dependabot's own `dependabot/…` branches are allowed.
- A ruleset on `main` allows changes only through pull requests with `branch-name`, `verify`,
  `kit and CLI on Node 24` and `Image` passing, with no force pushes and no deletion. A second
  ruleset stops `v*` and `kit-v*` tags from being moved or deleted.
- A release is a `chore/release-X.Y.Z` pull request (or `chore/release-kit-A.B.C`), then a signed
  tag on the merge commit. Nothing is merged back.
- Merging to `main` publishes the image as `sha-<short>` only. A `v*` tag publishes `X.Y.Z`,
  `X.Y` and the CLI; a stable tag also moves `latest` (a pre-release tag doesn't). A `v*` tag
  whose version matches `package.json` rebuilds the website, so spotcraft.dev shows the released
  docs.
- Deploying Spotcraft stays a manual run of the Deploy workflow with a tag.

## Consequences

- One pull request per change and one per release; no back-merge, no drift between branches.
- `main` holds unreleased work. The image tag `latest` and the website now follow releases, not
  `main`.
- Branch names are checked, so a branch an agent's worktree names on its own (`claude/…`) has to
  be pushed under a `feature/`, `bugfix/` or `chore/` name.
- Renaming one of the required CI jobs means updating the `main` ruleset in the same change.
