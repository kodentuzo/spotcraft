<script lang="ts">
  import type { AppStatus, BackupStatus } from '@spotcraft/agent/apps'
  import { backupHealth } from '#lib/backup.ts'
  import StatusBadge from '#lib/components/StatusBadge.svelte'
  import UptimeBars from '#lib/components/UptimeBars.svelte'
  import { ago, bytes, count } from '#lib/format.ts'
  import { hue } from '#lib/icon.ts'
  import { memoryLimit } from '#lib/overview.ts'

  interface Details {
    requests: Record<string, number>
    visitors: Record<string, number>
    domains: Record<string, string[]>
  }

  interface Props {
    app: AppStatus
    uptime: number | undefined
    uptimeHourly: Array<[number, number]>
    /** Memory in use, in bytes. */
    memory: number | undefined
    /** The last backup; undefined when backups aren't set up. */
    backup?: BackupStatus | null
    details: Promise<Details> | null
  }

  let { app, uptime: ratio, uptimeHourly, memory, backup, details }: Props = $props()

  const host = $derived(app.domain ?? app.hostnames[0])
  const backupState = $derived(backup === undefined ? 'ok' : backupHealth(backup))
  const backupLabel = { ok: '', failed: 'Last backup failed', overdue: 'Backup overdue', none: 'Never backed up' }
  const deploy = $derived(app.lastDeploy)
  // Docker's "Up 3 hours (healthy)", without the health the badge already shows: until the agent
  // has recorded a deploy, how long it has run is the best there is.
  const running = $derived(app.status.replace(/\s*\(.*\)$/, ''))
  const limit = $derived(memoryLimit(app.memory))
  const memoryShare = $derived(memory !== undefined && limit ? memory / limit : null)

  let iconFailed = $state(false)
  // An icon that failed before the page hydrated fired its error event too early: check it.
  const checkIcon = (img: HTMLImageElement) => {
    if (img.complete && img.naturalWidth === 0) iconFailed = true
  }
</script>

<li class="relative flex flex-col gap-3 p-4 transition-colors hover:bg-raised md:flex-row md:items-center md:gap-6">
  <div class="flex min-w-0 flex-1 items-center gap-3">
    <!-- The app's icon, or its initial, on a color of its own. -->
    <div class="tile relative flex size-12 shrink-0 items-center justify-center" style="--hue: {hue(app.name)}" aria-hidden="true">
      <span class="font-heading text-title-3 font-bold uppercase">{app.name.charAt(0)}</span>
      {#if !iconFailed}
        <img src="/apps/{app.name}/icon" alt="" width="32" height="32" loading="lazy" class="absolute size-8 object-contain" onerror={() => (iconFailed = true)} {@attach checkIcon} />
      {/if}
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <h2 class="truncate text-headline">
          <!-- The whole row opens the app; the host link sits above it. -->
          <a href="/apps/{app.name}" class="after:absolute after:inset-0 focus-visible:outline-none">{app.name}</a>
        </h2>
        <StatusBadge state={app.state} health={app.health} />
      </div>
      {#if host}
        <a href="https://{host}" class="relative z-10 block truncate text-footnote text-muted-foreground hover:text-foreground hover:underline" rel="noopener noreferrer" target="_blank">{host}</a>
      {/if}
      <p class="truncate text-caption-1 text-muted-foreground">
        {#if deploy && !deploy.ok}
          <span class="text-destructive">Deploy of <span class="font-mono">{deploy.tag}</span> failed {ago(deploy.at)}</span>{` · running `}<span class="font-mono">{deploy.lastOkTag ?? app.tag}</span>
        {:else if deploy}
          <span class="font-mono">{deploy.tag}</span>{` · deployed ${ago(deploy.at)}`}
        {:else}
          <span class="font-mono">{app.tag}</span>{#if running}{` · ${running}`}{/if}
        {/if}
      </p>
      <!-- Only what needs a look: nothing when all is well. -->
      {#if backupState !== 'ok'}<p class="truncate text-caption-1 text-destructive">{backupLabel[backupState]}</p>{/if}
      {#await details then d}
        {#if d?.domains[app.name]}<p class="truncate text-caption-1 text-destructive">Not live yet: {d.domains[app.name].join(', ')}</p>{/if}
      {/await}
    </div>
  </div>

  <dl class="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 md:w-[26rem] md:shrink-0 md:grid-cols-[10rem_8rem_minmax(0,1fr)]">
    <div>
      <dt class="text-caption-1 text-muted-foreground md:sr-only">Uptime, 24 hours</dt>
      <dd><UptimeBars series={uptimeHourly} {ratio} /></dd>
    </div>
    <div>
      <dt class="text-caption-1 text-muted-foreground md:sr-only">Memory</dt>
      <dd>
        <p class="text-footnote tabular-nums {memoryShare !== null && memoryShare >= 0.9 ? 'text-destructive' : ''}">
          {memory === undefined ? '—' : bytes(memory)}<span class="text-muted-foreground">{` / ${limit ? bytes(limit) : app.memory}`}</span>
        </p>
        <div class="mt-1 h-1 bg-muted" aria-hidden="true">
          {#if memoryShare !== null}
            <div class="h-full {memoryShare >= 0.9 ? 'bg-destructive' : 'bg-muted-foreground/60'}" style="width: {Math.min(100, memoryShare * 100)}%"></div>
          {/if}
        </div>
      </dd>
    </div>
    <div class="text-right">
      {#await details}
        <dt class="text-caption-1 text-muted-foreground">Visitors</dt>
        <dd class="text-headline text-muted-foreground">…</dd>
      {:then d}
        {#if d?.visitors[app.name] !== undefined}
          <dt class="text-caption-1 text-muted-foreground">Visitors 7d</dt>
          <dd class="text-headline tabular-nums">{count(d.visitors[app.name])}</dd>
        {:else}
          <dt class="text-caption-1 text-muted-foreground">Requests 24h</dt>
          <dd class="text-headline tabular-nums">{count(d?.requests[app.name])}</dd>
        {/if}
      {/await}
    </div>
  </dl>
</li>

<style>
  .tile {
    background: oklch(0.92 0.05 var(--hue));
    color: oklch(0.45 0.09 var(--hue));
  }
  @media (prefers-color-scheme: dark) {
    .tile {
      background: oklch(0.32 0.07 var(--hue));
      color: oklch(0.8 0.08 var(--hue));
    }
  }
</style>
