# @spotcraft/ui

Shared UI for `apps/dashboard` and `apps/site`: [shadcn-svelte](https://shadcn-svelte.com)
components (the `vega` style; lucide icons, added with the first component that needs them) and
the theme, which comes from [spotstrap](https://spotstrap.dev) (`@kodentuzo/spotstrap`, its
`spotcraft` theme: neutral colors, square corners, Space Grotesk; [ADR 0033](../../docs/decisions/0033-theme-from-spotstrap.md)).
Source-only: the apps compile it, there is no build.

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
generates their classes. It also brings spotstrap's component classes (`btn`, `btn-outline`,
`field`, `input`…), which need no JavaScript. Light and dark follow the system setting.

The theme's tokens are Tailwind `--color-*` variables (`bg-primary`, `text-muted-foreground`).
In arbitrary values, use those names: `var(--color-secondary)`, not `var(--secondary)`.

| Export                | What                                    |
| --------------------- | --------------------------------------- |
| `./styles.css`        | Tailwind, spotstrap and its theme, font |
| `./components/<name>` | a component (`button`, `card`)          |
| `./utils`             | `cn` and the shadcn-svelte helper types |

Inside the package, files import each other through `#ui/*` (package `imports`).

## Add a component

```sh
cd packages/ui
pnpm dlx shadcn-svelte@latest add <component> -y --no-deps-install
```

Then move any dependencies the CLI added from `devDependencies` to `dependencies` (the apps
need them installed) and run `pnpm install` from the root.

```sh
pnpm --filter @spotcraft/ui typecheck
```
