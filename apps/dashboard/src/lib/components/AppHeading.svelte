<script lang="ts">
  import type { AppStatus } from '@spotcraft/agent/apps'
  import type { Snippet } from 'svelte'
  import AppTile from '#lib/components/AppTile.svelte'
  import StatusBadge from '#lib/components/StatusBadge.svelte'

  /** A section's heading for one app: what the page is, for which app. */
  let {
    title,
    app,
    children,
  }: {
    title: string
    app: Pick<AppStatus, 'name' | 'state' | 'health' | 'domain' | 'hostnames'>
    children?: Snippet
  } = $props()
</script>

<header class="mb-6 flex flex-wrap items-center justify-between gap-4">
  <div class="flex min-w-0 items-center gap-3">
    <AppTile name={app.name} host={app.domain ?? app.hostnames[0]} />
    <div class="min-w-0">
      <h1 class="font-heading text-title-1 font-bold">{title}</h1>
      <p class="flex items-center gap-2 text-footnote text-muted-foreground">
        <a href="/{app.name}" class="hover:text-foreground hover:underline">{app.name}</a>
        <StatusBadge state={app.state} health={app.health} />
      </p>
    </div>
  </div>
  {@render children?.()}
</header>
