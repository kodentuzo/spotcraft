# Contributing

`main` is the only long-lived branch ([ADR 0042](docs/decisions/0042-one-branch.md)). Work
happens on short-lived branches cut from it and merged back into it through pull requests.
Releases are signed version tags on `main`.

- **Branches:** `feature/<name>`, `bugfix/<name>` or `chore/<name>` (dependencies, CI, docs,
  releases), cut from `origin/main`, with lowercase letters, digits, dots and hyphens. CI's
  `branch-name` check fails anything else, and any pull request that doesn't target `main`.
- **Commits** are signed, in the Conventional Commits style (`type(scope): summary`). Note
  user-facing changes under `Unreleased` in `CHANGELOG.md`, and update the package's README in
  the same change.
- **Pull requests** merge once `branch-name`, `verify`, `kit and CLI on Node 24` and `Image`
  pass, with a **merge commit**. Squash and rebase merges are off: a rebase rewrites the commits
  and drops their signatures. GitHub deletes the branch after merging.
- **`main`** is protected: changes arrive only through pull requests with passing checks, with no
  force pushes and no deletion. Merging publishes the image as `sha-<short>` and deploys nothing.
- **Releases** are a `chore/release-X.Y.Z` pull request, then a signed `vX.Y.Z` tag, which
  publishes the image and the CLI and rebuilds the website. Version tags can't be moved or
  deleted. The steps are in [docs/releasing.md](docs/releasing.md).

Setting up and running the project: [README.md](README.md) and [CLAUDE.md](CLAUDE.md).
