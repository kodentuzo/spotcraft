---
title: All UI is shadcn-svelte, with its own theme
number: 41
status: accepted
implementation: skeleton
date: 2026-11-21
supersedes: [24, 33]
superseded_by: []
notes: "The theme is in packages/ui and spotstrap is gone; the dashboard and site still have hand-made parts to move onto the components."
---

# All UI is shadcn-svelte, with its own theme

## Context

[ADR 0033](0033-theme-from-spotstrap.md) took the theme and plain-CSS component classes from
spotstrap. spotstrap is not settled yet, and two sets of components (spotstrap's classes and
shadcn-svelte's) for one look is more than this project needs. This record replaces ADR 0033.

[ADR 0024](0024-website-on-pages.md) made the website plain Astro with no UI framework. This
record replaces that one rule: the site renders the shared Svelte components at build time. The
rest of ADR 0024 (static output, GitHub Pages, no client-side JavaScript) stands.

## Decision

- `@spotcraft/ui` declares the theme itself in `styles.css`: shadcn-svelte's neutral colors as
  CSS variables mapped to Tailwind `--color-*` tokens, square corners (`--radius: 0`), Space
  Grotesk. Light and dark follow the system setting (`prefers-color-scheme`); there is no toggle.
- The components in `packages/ui` are stock shadcn-svelte, added with its CLI. Icons are lucide.
  Charts are shadcn-svelte's chart component.
- The dashboard and the site use those components for every control, card, table, menu and
  chart, rather than hand-made markup.
- The site has `@astrojs/svelte` and renders Svelte components at build time. No page uses a
  `client:` directive, so the CSP keeps `script-src 'none'`.
- The package stays private to the workspace and source-only.

## Consequences

- One component set and one theme, owned here; a theme change is an edit to `styles.css`.
- The spotstrap type scale (`text-footnote`, `text-headline`…) and its 44px controls are gone:
  pages use Tailwind's sizes, and controls are shadcn-svelte's sizes.
- The owner's other apps don't share this theme until there is a reason to package it.
- Interactive components (menus, dialogs) don't work on the site, which runs no scripts; it uses
  only components that render as plain HTML.
