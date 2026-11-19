---
name: Vinskiano
order: 2
url: https://vinskiano.app
source: https://github.com/vindotski/vinskiano
oneLiner: A three-oscillator synth that plays in the browser. No install, no account, press a key.
about: >-
  Vinskiano is a synth with three oscillators, mixed like FL Studio's 3x Osc, and all 88 keys. It
  plays by touch, mouse or the computer keyboard, and fits on one screen on any device. You can
  save your sounds as presets without signing up.
features:
  - name: Guest accounts
    text: >-
      Saving a first preset makes the visitor a guest of the server's user pool, with no sign-up.
      Deleting a guest in the dashboard deletes their presets.
  - name: Database schema
    text: >-
      Presets live in the schema app_vinskiano of Spotcraft's Postgres. Spotcraft runs the
      image's migrations before a new version starts.
  - name: Deploys from CI
    text: >-
      After browser tests in three engines and a vulnerability scan, CI calls the app's deploy
      hook and waits until the new version is live.
  - name: Nightly backups
    text: >-
      At 03:00 UTC the schema and the app's settings go to Cloudflare R2, kept for 30 days.
  - name: No downtime
    text: >-
      A new version starts next to the old one and takes traffic once its health check passes.
      Rolling back is picking the previous tag.
  - name: Analytics without cookies
    text: >-
      Spotcraft adds the page-view script itself, so the app has no analytics code. It counts
      visits and sets no cookies.
  - name: Its own domain
    text: >-
      vinskiano.app took over its DNS records from the dashboard, behind a Cloudflare Tunnel, and
      www redirects to it.
  - name: Hardened container
    text: >-
      A read-only filesystem, a non-root user and a 256 MB limit. The app needs no environment
      variables of its own: Spotcraft sets them.
numbers:
  # TODO(numbers): read these off the Spotcraft dashboard, then set the date.
  date: null
  memory: null # TODO: memory in use, e.g. "80 MB"
  memoryLimit: 256 MB
  uptime: null # TODO: uptime over the last 30 days
  deployTime: null # TODO: CI's deploy job took 20-25 s on 18 and 19 November; confirm
  imageSize: null # TODO: Docker Hub shows 87.4 MB compressed for amd64 on 19 November; confirm
stack:
  - name: TanStack Start
    role: React 19 pages rendered on the server, and the presets API.
  - name: Web Audio
    role: The oscillators, mixer and oscilloscope, with no audio library.
  - name: React Aria
    role: Accessible knobs, menus and keys.
  - name: Drizzle ORM
    role: Presets and migrations in Postgres.
  - name: '@kodentuzo/spotkit'
    role: Reads the guest from the user pool's session.
  - name: Tailwind CSS 4 and Spotstrap
    role: The look, in light and dark.
screenshots:
  - light: /showcase/vinskiano-home-light.webp
    dark: /showcase/vinskiano-home-dark.webp
    alt: "Vinskiano's home page: A synth that plays in your browser, with a keyboard to play right there."
  - light: /showcase/vinskiano-synth-light.webp
    dark: /showcase/vinskiano-synth-dark.webp
    alt: The synth, with the master volume, an oscilloscope, a minimap of all 88 keys and a large keyboard.
  - light: /showcase/vinskiano-sound-light.webp
    dark: /showcase/vinskiano-sound-dark.webp
    alt: The three oscillators, each with a waveform, a mix knob and a pitch knob.
---

Vinskiano is a synth from 2020, written with Create React App, that was brought back to life in
November 2026. The first day was all tooling: pnpm, then Vite. Installed packages went from
1,672 to about 40, and the lockfile from 15,704 lines to 830. Almost all of the old dependency
tree had been build tooling. Version 1.0.0 shipped the next day.

Presets needed a database, so the next step was Spotcraft, with guest accounts from its kit.
The move found a bug in the kit itself: it read its migrations folder when imported, the app's
bundler left that folder behind, and the production build failed on every save. The fix went
into the library, which now ships its SQL built in. A rehearsal with the production limits
passed every browser test, read-only, with 256 MB, at about 80 MB of memory.

Version 2.0.0 ran on Spotcraft from 12 November. Version 3.0.0, on 19 November, moved the
presets into a schema of the shared database and the guests into the server's user pool, with
the dashboard's Move button. Guests kept their cookies and their sounds.

Every merge to main now runs browser tests in Chromium, Firefox and WebKit, scans the image, and
deploys it through the deploy hook. The app has no deploy scripts and no server of its own any
more.
