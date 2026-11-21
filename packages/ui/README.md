# @spotcraft/ui

Shared UI for `apps/dashboard` and `apps/site`: stock [shadcn-svelte](https://shadcn-svelte.com)
components (the `vega` style; lucide icons) and the theme: neutral colors, square corners, Space
Grotesk ([ADR 0041](../../docs/decisions/0041-all-ui-from-shadcn-svelte.md)). Source-only: the
apps compile it, there is no build.

## Use it in an app

```css
/* src/routes/layout.css */
@import "@spotcraft/ui/styles.css";
```

```svelte
<script lang="ts">
  import { Button } from '@spotcraft/ui/components/button'
  import * as Card from '@spotcraft/ui/components/card'
</script>
```

The app needs Tailwind v4 (`@tailwindcss/vite`) and `"@spotcraft/ui": "workspace:*"`.
`styles.css` carries an `@source` for this package's components, so the app's Tailwind
generates their classes. The site (Astro) renders the components at build time through
`@astrojs/svelte`.

The theme is shadcn-svelte's CSS variables (`--primary`, `--muted-foreground`…) in `:root`,
mapped to Tailwind tokens (`bg-primary`, `text-muted-foreground`) with `@theme inline`.
`--radius` is 0. Light and dark follow the system setting (`prefers-color-scheme`); the `dark:`
variant follows it too, and there is no toggle.

| Export                | What                                    |
| --------------------- | --------------------------------------- |
| `./styles.css`        | Tailwind, the theme, the font           |
| `./components/<name>` | a component (`button`, `card`)          |
| `./utils`             | `cn` and the shadcn-svelte helper types |

Components: `alert`, `alert-dialog`, `badge`, `button`, `card`, `input`, `label`, `separator`,
`table`, `textarea`. They are as the CLI writes them; change a component's look with classes
where it is used, not by editing it.

Inside the package, files import each other through `#ui/*` (package `imports`).

## Add a component

```sh
cd packages/ui
pnpm exec shadcn-svelte add <component> -y --no-deps-install
```

The CLI may change dependency ranges in `package.json` (it pins `tailwind-variants` to an older
major): keep the existing ones. Move any new dependency it added from `devDependencies` to
`dependencies` (the apps need it installed), run `pnpm install` from the root, then `pnpm fix`
to format the new files.

```sh
pnpm --filter @spotcraft/ui typecheck
```
