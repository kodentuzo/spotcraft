<script lang="ts">
  import type { AppStatus, BackupStatus } from '@spotcraft/agent/apps'
  import { backupHealth } from '#lib/backup.ts'
  import AppTile from '#lib/components/AppTile.svelte'
  import MemoryBar from '#lib/components/MemoryBar.svelte'
  import StatusBadge from '#lib/components/StatusBadge.svelte'
  import UptimeBars from '#lib/components/UptimeBars.svelte'
  import { ago, bytes, count } from '#lib/format.ts'
  import { MEMORY_TIGHT, memoryLimit, memoryShare } from '#lib/overview.ts'
  import { runningFor } from '#lib/status.ts'

  interface Details {
    requests: Record<string, number>
    visitors: Record<string, number>
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
    /** Custom hosts not live yet, per app. */
    domains: Promise<Record<string, string[]>> | null
    /** When the page was made (ms), for the uptime bars. */
    now: number
  }

  let { app, uptime: ratio, uptimeHourly, memory, backup, details, domains, now }: Props = $props()

  const host = $derived(app.domain ?? app.hostnames[0])
  const backupState = $derived(backup === undefined ? 'ok' : backupHealth(backup))
  const backupLabel = { ok: '', failed: 'Last backup failed', overdue: 'Backup overdue', none: 'Never backed up' }
  const deploy = $derived(app.lastDeploy)
  // Until the agent has recorded a deploy, how long it has run is the best there is.
  const running = $derived(runningFor(app.status))
  const limit = $derived(memoryLimit(app.memory))
  const share = $derived(memoryShare(memory, app.memory))

</script>

<li class="relative flex flex-col gap-3 p-4 transition-colors hover:bg-muted md:flex-row md:items-center md:gap-6">
  <div class="flex min-w-0 flex-1 items-center gap-3">
    <AppTile name={app.name} {host} />
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <h2 class="truncate text-base font-semibold">
          <!-- The whole row opens the app; the host link sits above it. -->
          <a href="/{app.name}" class="after:absolute after:inset-0 focus-visible:outline-none">{app.name}</a>
        </h2>
        <StatusBadge state={app.state} health={app.health} />
      </div>
      {#if host}
        <a href="https://{host}" class="relative z-10 block truncate text-sm text-muted-foreground hover:text-foreground hover:underline" rel="noopener noreferrer" target="_blank">{host}</a>
      {/if}
      <p class="truncate text-xs text-muted-foreground">
        {#if deploy && !deploy.ok}
          <span class="text-destructive">Deploy of <span class="font-mono">{deploy.tag}</span> failed {ago(deploy.at)}</span>{` · running `}<span class="font-mono">{app.tag}</span>
        {:else if deploy}
          <span class="font-mono">{app.tag}</span>{` · deployed ${ago(deploy.at)}`}
        {:else}
          <span class="font-mono">{app.tag}</span>{#if running}{` · ${running}`}{/if}
        {/if}
      </p>
      <!-- Only what needs a look: nothing when all is well. -->
      {#if backupState !== 'ok'}<p class="truncate text-xs text-destructive">{backupLabel[backupState]}</p>{/if}
      {#await domains then notLive}
        {#if notLive?.[app.name]}<p class="truncate text-xs text-destructive">Not live yet: {notLive[app.name].join(', ')}</p>{/if}
      {/await}
    </div>
  </div>

  <dl class="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 md:w-[26rem] md:shrink-0 md:grid-cols-[10rem_8rem_minmax(0,1fr)]">
    <div>
      <dt class="text-xs text-muted-foreground md:sr-only">Uptime, 24 hours</dt>
      <dd><UptimeBars series={uptimeHourly} {ratio} {now} /></dd>
    </div>
    <div>
      <dt class="text-xs text-muted-foreground md:sr-only">Memory</dt>
      <dd>
        <p class="text-sm tabular-nums {share !== null && share >= MEMORY_TIGHT ? 'text-destructive' : ''}">
          {memory === undefined ? '—' : bytes(memory)}<span class="text-muted-foreground">{` / ${limit ? bytes(limit) : app.memory}`}</span>
        </p>
        <div class="mt-1"><MemoryBar {share} /></div>
      </dd>
    </div>
    <div class="text-right">
      {#await details}
        <dt class="text-xs text-muted-foreground">Visitors</dt>
        <dd class="text-base font-semibold text-muted-foreground">…</dd>
      {:then d}
        {#if d?.visitors[app.name] !== undefined}
          <dt class="text-xs text-muted-foreground">Visitors 7d</dt>
          <dd class="text-base font-semibold tabular-nums">{count(d.visitors[app.name])}</dd>
        {:else}
          <dt class="text-xs text-muted-foreground">Requests 24h</dt>
          <dd class="text-base font-semibold tabular-nums">{count(d?.requests[app.name])}</dd>
        {/if}
      {/await}
    </div>
  </dl>
</li>
