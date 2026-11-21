---
title: Apps own their UI; Spotcraft offers services, Spotstrap blocks
number: 43
status: accepted
implementation: planned
date: 2026-11-21
supersedes: [38]
superseded_by: []
notes: "Partly supersedes 0038: Caddy no longer injects the analytics script, and /_spotcraft/privacy goes away. Nothing is built yet. Already there: idle guests are deleted (ADR 0035). Sokobanko is the first app to follow it."
---

# Apps own their UI; Spotcraft offers services, Spotstrap blocks

## Context

Every new app repeats the same work: guests and sign-in, analytics, a legal notice, a privacy
policy, a way for people to download or delete their data, and SEO basics. Sokobanko did all of
it by hand. Its legal notice needs the owner's postal address, which can't be committed, so it
reads it from an env var the app invented.

Spotcraft already gives apps a contract of standards ([ADR 0034](0034-app-contract.md)), a user
pool ([ADR 0035](0035-auth-pool.md)), spotkit ([ADR 0036](0036-spotkit.md)) and a local stack
([ADR 0037](0037-local-stack-per-repo.md)). [ADR 0038](0038-analytics.md) also has Caddy change
apps' pages: it injects the analytics script into their HTML and serves a privacy page at
`/_spotcraft/privacy`. An injected page looks like the platform, not the app, and an app that
moves off Spotcraft loses it. This record replaces those two rules of ADR 0038. The rest of
ADR 0038 stands.

The owner builds apps for the web (vanilla TypeScript, React, Vue, Svelte, rendered on the
client or the server) and for phones (React Native). spotstrap, the owner's design package, is
not settled yet; [ADR 0041](0041-all-ui-from-shadcn-svelte.md) took it out of the dashboard,
which keeps its own theme.

## Decision

### Spotcraft offers services and facts; apps own every pixel

- **Spotcraft never changes an app's responses.** Caddy stops injecting the analytics script,
  and `/_spotcraft/privacy` is removed. The routes under `/_spotcraft/*` stay as services:
  `auth/*`, `s.js`, `e`, `config.json`, and a new `legal.json`.
- **Every feature an app gets from Spotcraft passes three tests:**
  1. it is written down in [docs/contracts.md](../contracts.md);
  2. `spotcraft dev` offers it locally;
  3. it runs without Spotcraft, from published images and env vars.
- **`spotcraft dev`'s stack is the reference** for what the server gives an app. A self-hosting
  example is the same stack without the development settings.

### Legal facts are platform data

- **The owner's identity** (name, postal address, contact email) is set once in the dashboard,
  never in a repository.
- **The platform adds what it knows:** the hosting provider and location, the edge, backups and
  how long they are kept, SMTP, analytics and what it collects, and the pool's cookie and
  retention.
- **Apps get the facts in two ways:**
  - servers read one reserved env var holding them as JSON;
  - clients without a server (static, client-rendered and native apps) read
    `/_spotcraft/legal.json`.
- `spotcraft dev` writes placeholders. Outside Spotcraft, the owner sets the env var.
- **Each app writes only what it stores itself** in its own privacy page.

### Data rights and retention live in the pool

- **A signed-in user can export and delete themselves** through the pool. Deleting a user
  cascades through apps' foreign keys (ADR 0035), so an app needs no delete code.
- **Retention:** expired sessions are deleted, and the IP address and user agent of a session
  are cleared after a set time. Guests unused for 180 days are deleted, as now.
- **No consent banner by design:** nothing the platform offers sets a cookie that needs
  consent. The pool's cookie is set on a user's first save and is needed for the app to work,
  and analytics uses no cookies.

### spotkit is the bridge

- spotkit wraps every service an app uses: who is signed in, `legal()`, `exportMe()`,
  `deleteMe()`, and the analytics tracker.
- It stays optional: everything it does is in the contract.

### Spotstrap: tokens, blocks and brand assets, at development time only

Spotstrap is never a runtime dependency on Spotcraft. It has three layers:

- **Tokens** come from one `brand.json` in the design-tokens format. A build turns them into:
  - CSS variables with shadcn's names (`--background`, `--primary`…), which every web framework
    reads and which render on the server;
  - a Tailwind v4 theme;
  - a TypeScript object for React Native.
- **Primitives are not Spotstrap's.** Each platform uses its shadcn port, which reads the same
  variable names:

  | Platform     | Port                    |
  | ------------ | ----------------------- |
  | React        | shadcn/ui               |
  | Vue          | shadcn-vue              |
  | Svelte       | shadcn-svelte           |
  | React Native | react-native-reusables  |
  | Vanilla      | Basecoat                |

- **Blocks** are the repeated pieces: sign-in, privacy policy, legal notice, your data, legal
  links and the analytics opt-out. Each block has two parts:
  - **a core**, published on npm, in framework-free TypeScript. It holds the data access, through
    a small client interface that spotkit implements; the state, such as the steps of deleting;
    the copy, with translations; and document models, such as the policy as sections. It never
    touches `window` or `document` when imported, and it formats dates and numbers with a fixed
    locale and time zone, so server and client render the same.
  - **views**, about 50 to 150 lines per block per platform, built from that platform's
    primitives and copied into the app through a shadcn registry. The app owns them.
  - Vanilla gets a function that renders a block to HTML, and a small script that makes it
    interactive.
  - React Native gets native views for sign-in and your data, and links to the app's web pages
    for the legal texts.
- **Brand assets** (favicons, app icons, the web manifest, Open Graph images) come from a
  Spotstrap command at development time, from `brand.json`. Spotcraft makes no assets.
- **Order:** tokens for all five platforms, the core and Vue views first. Other views come when
  an app needs them.

### Sokobanko is the first case

Sokobanko uses Spotstrap's Vue blocks, reads the facts from Spotcraft and deletes users through
the pool. A CI job runs it from the self-hosting stack, without Spotcraft, and passes its smoke
test.

## Consequences

- An app can leave Spotcraft without losing a page. Outside Spotcraft, its owner runs the same
  published pieces and sets the env vars.
- Apps that relied on the injected script must add the tracker. The release that removes the
  injection gives the steps.
- Apps have more code in them, but they own it, and the core keeps the logic in one place.
- Views for five platforms are a maintenance cost. Building them only when an app needs one
  keeps it down.
- A policy built from the facts is only as accurate as the owner's settings, and still needs one
  legal review.
- It isn't checked yet whether Basecoat and react-native-reusables install from a custom
  registry. If not, their views ship as npm exports instead.
- The dashboard keeps its own theme ([ADR 0041](0041-all-ui-from-shadcn-svelte.md)).
