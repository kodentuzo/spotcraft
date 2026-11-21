---
name: release
description: Prepare a Spotcraft or @spotcraft/kit release — version bump, changelog, release PR to main, tag instructions and what CI then publishes. Use when the user asks to cut, prepare or check a release, or to bump a version.
---

# Release

The process and what a version promises are in `docs/releasing.md` and ADR 0019; read both
first, they win over this skill. You prepare and check; you merge and tag only when the user
asks.

## Before

1. Work is merged into `main`, CI is green there, and `CHANGELOG.md`'s `Unreleased` section
   covers everything since the last tag (`git log --oneline vX.Y.Z..origin/main`).
2. Pick the version with Semantic Versioning at 0.y.z: a breaking change to the public API
   (ADR 0019's list: image names and tags, deploy variables, `.env` and Compose names, OpenTofu
   variables and outputs, the agent API, npm packages' names and exports, the CLI) raises the
   **minor**; anything else the **patch**. Say which entries make it breaking.
3. Breaking entries need migration steps in the changelog.

## Prepare (on a `chore/release-X.Y.Z` branch from `origin/main`)

0. If `packages/kit/src` changed since the kit's last `kit-v` tag, release the kit first
   (`docs/releasing.md`, "A kit release"): `node scripts/check-versions.ts --kit A.B.C`, its own
   `packages/kit/CHANGELOG.md`, tag `kit-vA.B.C`. CI refuses a Spotcraft tag whose kit isn't
   published.
1. `node scripts/check-versions.ts X.Y.Z` sets every workspace package but the kit; `pnpm check:versions`
   confirms.
2. In `CHANGELOG.md`, rename `Unreleased` to `[X.Y.Z] - YYYY-MM-DD`, add a fresh empty
   `Unreleased`, and add the compare links at the bottom.
3. `pnpm verify` passes.
4. Commit (`chore(release): X.Y.Z`) and open a PR **into `main`** with the changelog
   section as its body. There is no other branch to merge back into (ADR 0042).

## Tagging (when the user asks)

```bash
git fetch origin && git tag -s vX.Y.Z 'origin/main^{commit}' -m vX.Y.Z && git push origin vX.Y.Z   # kit first: kit-vA.B.C
```

CI verifies the tagged commit and publishes the `spotcraft` image (`X.Y.Z`, `X.Y`, `latest`) and
the npm packages; the Pages workflow rebuilds the website from the tag. Draft a GitHub Release
from the changelog section (`gh release create vX.Y.Z --title vX.Y.Z --notes-file <section>`).
Deploying stays a manual run of the Deploy workflow with the tag, by the user or when they ask.
Afterwards, check the CI run and the published versions (the registry's JSON at
`registry.npmjs.org/@kodentuzo%2fspotcraft`, since `npm view` can lag; Docker Hub's
`/v2/repositories/<ns>/spotcraft/tags/X.Y.Z`), and tell the user what is live. Tags are signed
with the local git setup, and a ruleset stops pushed tags from being moved or deleted.
