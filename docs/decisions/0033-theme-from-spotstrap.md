---
title: The theme and plain-CSS components come from spotstrap
number: 33
status: accepted
implementation: done
date: 2026-11-19
supersedes: [6, 24]
superseded_by: []
notes: "The dashboard keeps its shadcn-svelte components for now; the site's button links use btn."
---

# The theme and plain-CSS components come from spotstrap

## Context

[ADR 0006](0006-shared-ui.md) put the theme in `packages/ui/src/styles.css`, written out from the
shadcn-svelte preset `b6RdvRWulu`. This record replaces that part. [ADR 0024](0024-website-on-pages.md)
had the website copy the Svelte button's Tailwind classes by hand; this record replaces that part
too.

The owner's other apps need the same look, some of them without Svelte or without JavaScript.
[`@kodentuzo/spotstrap`](https://spotstrap.dev) is the owner's Tailwind v4 library for that: the
shadcn token names as static `--color-*` values, light and dark themes, touch-first sizes, Apple's
type scale, and component classes in plain CSS (`btn`, `field`, `dialog`…). It has a `spotcraft`
theme with the same colors, square corners and Space Grotesk.

## Decision

- `@spotcraft/ui` depends on `@kodentuzo/spotstrap`. `styles.css` imports
  `@kodentuzo/spotstrap/tailwind.css` and `themes/spotcraft.css` instead of declaring the tokens.
  It still imports Tailwind, `tw-animate-css` and `shadcn-svelte/tailwind.css` for the
  shadcn-svelte components, the font, and `@source "./components"`.
- Light and dark follow the system setting, as before.
- The shadcn-svelte components stay in `packages/ui` and read the same `--color-*` tokens. Where a
  plain-CSS spotstrap class does the job (the site, which runs no scripts), the page uses it
  instead of a copy of the component's classes.
- spotstrap is excepted from `minimumReleaseAge` in `pnpm-workspace.yaml`: it is the owner's own
  package, published from CI with provenance (`trustPolicy` still checks it), and its releases
  are needed the same day.

## Consequences

- One theme for every app of the owner's; a theme change is a spotstrap release and a dependency
  update here.
- The tokens are only `--color-*`. Component code that read the unprefixed shadcn variables
  (`var(--secondary)`) has to use the prefixed names.
- Body text is 17px (spotstrap's `text-body`); text without a size class is 1px larger than
  before. The site's buttons are 44px tall.
- The dashboard's components (button `h-9`, tables, dialogs) still come from shadcn-svelte.
  Moving them onto spotstrap's sizes and classes is separate work.
