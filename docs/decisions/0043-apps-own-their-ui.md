---
title: Apps own their UI; Spotcraft offers services, Spotstrap blocks
number: 43
status: accepted
implementation: skeleton
date: 2026-11-21
supersedes: [38]
superseded_by: []
notes: "Partly supersedes 0038: Caddy no longer injects the analytics script, and /_spotcraft/privacy goes away. Built in step 2: the pool's export (GET /_spotcraft/auth/export, without tokens or hashes); self-delete is Better Auth's anonymous plugin (POST /_spotcraft/auth/delete-anonymous-user), on by default; the deletion log (auth.deletions, filled by a SECURITY DEFINER trigger so every way of deleting counts, kept AUTH_BACKUP_DAYS); the daily job that deletes expired sessions and clears IP addresses and user agents after AUTH_IP_DAYS. Found while building: Spotcraft keeps no access logs (Caddy has no log directive, the dashboard's login lockout is in memory), so the 30-day rule for logs binds apps; Docker caps container logs by size (3 x 10 MB), not age. Not built yet: replaying the log on a restore, the legal facts, analytics modes, spotkit, Spotstrap. Sokobanko is the first app to follow it."
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
  3. it runs without Spotcraft, from published images, env vars and static files.
- **`spotcraft dev`'s stack is the reference** for what the server gives an app. A self-hosting
  example is the same stack without the development settings.

### Legal facts are platform data

- **The owner's identity** (name, postal address, contact email) is set once in the dashboard,
  never in a repository.
- **The owner picks their supervisory authority** in the dashboard, for the right to complain.
- **The platform adds what it knows,** as one entry per processing: the hosting provider and
  location, the edge, backups, SMTP, analytics, the pool's cookie and sessions, and logs. Each
  entry says:
  - what data it covers and its purpose;
  - its legal basis (GDPR Art. 6), such as running the service or a legitimate interest;
  - how long the data is kept;
  - the processor, if any, and any transfer outside the EU with its basis, such as Cloudflare
    under the EU–US Data Privacy Framework.
- **The core's copy holds what every policy says the same way:** the user's rights, how to use
  them, and the right to complain.
- **The facts are one JSON document** with an `updated` date, which changes whenever any fact
  does. A policy shows it as its "last changed" date.
- **Apps get the facts in two ways:**
  - servers read the reserved env var `LEGAL_FACTS`;
  - clients without a server (static, client-rendered and native apps) read
    `/_spotcraft/legal.json`.
- **When a fact changes,** `legal.json` changes at once, and the agent redeploys every container
  app so it reads the new `LEGAL_FACTS`, with no downtime
  ([ADR 0028](0028-zero-downtime-deploys.md)).
- `spotcraft dev` writes placeholders. Outside Spotcraft, the owner sets `LEGAL_FACTS` and
  serves the same JSON as a file at `/_spotcraft/legal.json`.
- **Each app writes only what it stores itself** in its own privacy page.

### Data rights and retention live in the pool

- **A signed-in user can delete themselves** through the pool. Deleting a user cascades through
  apps' foreign keys (ADR 0035), so an app needs no delete code. If an app's foreign key blocks
  the delete, the user sees an error, and the dashboard names the table, as it does for idle
  guests.
- **Deletions survive a restore.** The pool keeps a deletion log, the user's id and the time
  only, for as long as backups are kept (30 days). A restore deletes those users again. The
  policy says how long backups keep data.
- **Export is split:** the pool exports what it holds (the user and their sessions), and each
  app exports its own rows. The your-data block puts both in one download.
- **Retention:**
  - expired sessions are deleted every day, next to the job that deletes idle guests;
  - a session's IP address and user agent are cleared 30 days after it was last used, an
    instance setting;
  - guests unused for 180 days are deleted, as now;
  - logs (Caddy's and the apps' container logs) keep a client's IP address for 30 days at most.

### Consent depends on the analytics mode

The pool's cookie is set on a user's first save and is needed for the app to work, so it needs no
consent. Analytics may need it, depending on the country: ePrivacy rules may count a script that
reads the device as access to it. So analytics has three modes, set for the instance:

- **server** counts requests (Caddy) and accounts (the pool) only. No script runs and nothing
  reads the device, so no consent is needed anywhere.
- **opt-out** is the default: Umami's script, cookieless, aggregated, kept 13 months, with an
  opt-out. This fits audience-measurement exemptions such as France's.
- **opt-in** loads Umami's script only after the user agrees, through a consent block the app
  shows. Use it where no exemption applies, such as Germany.

`config.json` says the mode, and spotkit's tracker follows it. The per-app Analytics switch of
ADR 0038 stays.

### What the owner still does

Spotcraft can't do these for the owner, so the dashboard's legal page lists them:

- data processing agreements with the processors (Hetzner and Cloudflare in their consoles, and
  the SMTP provider);
- the record of processing (GDPR Art. 30): the facts are that record, and the page exports them;
- answering requests sent by email within a month (GDPR Art. 12);
- reporting a breach within 72 hours (GDPR Art. 33), with a guide in `docs/guides/`.

### spotkit is the bridge

- spotkit wraps every service an app uses: who is signed in, `legal()`, `exportMe()` (the
  pool's part), `deleteMe()`, and the analytics tracker.
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
  links, and the analytics opt-out and consent prompt. Each block has two parts:
  - **a core**, published on npm, in framework-free TypeScript. It holds the data access, through
    a small client interface that spotkit implements; the state, such as the steps of deleting;
    the copy, with translations; and document models, such as the policy as sections. It never
    touches `window` or `document` when imported, and it formats dates and numbers with a fixed
    locale and time zone, so server and client render the same.
  - **views**, about 50 to 150 lines per block per platform, built from that platform's
    primitives and copied into the app through a shadcn registry. The app owns them.
  - Vanilla gets a function that renders a block to HTML, and a small script that makes it
    interactive.
  - React Native gets native views for sign-in and your data, and links to web pages for the
    legal texts: the app's website, or its API's domain when it has no website. A native view
    of the core's document model can come later.
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
- Apps that relied on the injected script must add the tracker, and those with analytics on must
  show the opt-out block. The release that removes the injection, and with it the opt-out at
  `/_spotcraft/privacy`, comes after they do, and gives the steps.
- The deletion log is itself personal data. It holds ids only, and only for 30 days.
- The owner still signs the processors' agreements and answers requests. Spotcraft lists what
  to do, but can't do it.
- Apps have more code in them, but they own it, and the core keeps the logic in one place.
- Views for five platforms are a maintenance cost. Building them only when an app needs one
  keeps it down.
- Copied views and the core can drift apart. The core follows semver; a breaking change ships
  with updated views in the registry, and its changelog says to add them again.
- Changing a fact redeploys every container app. Apps that start slowly take longer to show it.
- A policy built from the facts is only as accurate as the owner's settings, and still needs one
  legal review. The consent rules for analytics differ between EU countries; the mode is the
  owner's choice.
- It isn't checked yet whether Basecoat and react-native-reusables install from a custom
  registry. If not, their views ship as npm exports instead.
- The dashboard keeps its own theme ([ADR 0041](0041-all-ui-from-shadcn-svelte.md)).
