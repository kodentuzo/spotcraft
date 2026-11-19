---
name: Sokobanko
order: 1
url: https://sokobanko.app
source: https://github.com/vindotski/sokobanko
oneLiner: The classic box-pushing puzzle in the browser. Play at once, no sign-up, and your best results are saved.
about: >-
  Sokobanko is Sokoban: push every box onto a goal, and you can't pull. It has 159 levels that
  unlock in order, played with the keyboard or by dragging the board. You play in the browser,
  and when you solve a level the server replays your moves before it saves your best.
features:
  - name: Guest accounts
    text: >-
      A visitor becomes a guest of the server's user pool on their first solved level, with no
      sign-up. The pool answers on sokobanko.app itself and its cookie lasts a year.
  - name: Database schema
    text: >-
      Levels and results live in the schema app_sokobanko of Spotcraft's Postgres. Spotcraft runs
      the image's migrations before a new version starts.
  - name: Deploys from CI
    text: >-
      Merging to main builds the image, then CI calls the app's deploy hook. The hook's token can
      change the tag and nothing else.
  - name: Nightly backups
    text: >-
      At 03:00 UTC the schema and the app's settings go to Cloudflare R2, kept for 30 days.
  - name: No downtime
    text: >-
      A new version starts next to the old one and takes traffic once its health check passes. A
      version that never turns healthy never gets traffic.
  - name: Analytics without cookies
    text: >-
      Spotcraft adds the page-view script itself, so the app has no analytics code. It counts
      visits and sets no cookies.
  - name: Its own domain
    text: >-
      sokobanko.app took over its DNS records from the dashboard, behind a Cloudflare Tunnel, and
      www redirects to it.
  - name: Hardened container
    text: >-
      A read-only filesystem, a non-root user, 512 MB and one CPU, and security headers from
      Caddy.
numbers:
  # TODO(numbers): read these off the Spotcraft dashboard, then set the date.
  date: null
  memory: null # TODO: memory in use, e.g. "92 MB"
  memoryLimit: 512 MB
  uptime: null # TODO: uptime over the last 30 days, e.g. "99.98%"
  deployTime: null # TODO: CI's deploy job took about 20 s on 18 and 19 November; confirm
  imageSize: null # TODO: Docker Hub shows 62.6 MB compressed for amd64 on 19 November; confirm
stack:
  - name: Nuxt 4
    role: Vue pages, rendered on the server, and the API that checks solutions.
  - name: PixiJS 8
    role: Draws the board, with a camera that follows the player on big levels.
  - name: Drizzle ORM
    role: Levels, results and migrations in Postgres.
  - name: '@kodentuzo/spotkit'
    role: Reads the guest from the user pool's session.
  - name: Tailwind CSS 4 and Spotstrap
    role: The look, in light and dark.
  - name: TypeScript rules package
    role: The same game rules in the browser and on the server.
screenshots:
  - light: /showcase/sokobanko-home-light.webp
    dark: /showcase/sokobanko-home-dark.webp
    alt: "Sokobanko's home page: the title, a Let's play button and 159 levels and counting."
  - light: /showcase/sokobanko-play-light.webp
    dark: /showcase/sokobanko-play-dark.webp
    alt: The first level, First Push, with the player, one box and one goal, and undo, redo and restart below.
  - light: /showcase/sokobanko-levels-light.webp
    dark: /showcase/sokobanko-levels-dark.webp
    alt: The levels page with previews of each board; the first is up next and the rest are locked.
---

Sokobanko began as a question more than a game. Sokoban's rules fit in one sentence, which
leaves room for the product questions: can people play with zero clicks, keep their progress
without signing up, and can the server trust a result the browser sends?

The answer to the last one shaped the whole app. The game runs in the browser, so every move is
instant, even on a phone. When you solve a level, the browser sends your moves and the server
replays them with the same rules code before it saves your best. A forged result has to be a
real solution, and that is just playing the game.

The first version ran as a demo on another host. On 8 November 2026 it was rebuilt for
Spotcraft 0.2 and went live at sokobanko.app: a plain Postgres database instead of a hosted one,
guests from Spotcraft's kit, a distroless read-only image, and CI that pushes it to Docker Hub.
The first deploy never turned healthy, because the app was added without a database. The
message said so, and ticking the box fixed it.

It has grown with Spotcraft since. Releases go out from CI through the deploy hook, with no
downtime. On 19 November it moved into the server's user pool with the dashboard's Move button,
and guests kept their progress and their cookies. One rule makes all of that safe: migrations
only ever add, so an older version can always run on a newer database.
