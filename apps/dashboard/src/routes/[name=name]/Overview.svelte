<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import { backupHealth } from '#lib/backup.ts'
  import AppTile from '#lib/components/AppTile.svelte'
  import MemoryBar from '#lib/components/MemoryBar.svelte'
  import Sparkline from '#lib/components/Sparkline.svelte'
  import Stat from '#lib/components/Stat.svelte'
  import StatusBadge from '#lib/components/StatusBadge.svelte'
  import UptimeBars from '#lib/components/UptimeBars.svelte'
  import { ago, bytes, count, dateTime, milliseconds, percent, uptime } from '#lib/format.ts'
  import { MEMORY_TIGHT, memoryLimit, memoryShare } from '#lib/overview.ts'
  import { runningFor } from '#lib/status.ts'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  const app = $derived(data.app)
  const m = $derived(data.metrics)
  const deploy = $derived(app.lastDeploy)
  const last = (series: Array<[number, number]>) => (series.length ? series[series.length - 1][1] : null)
  const limit = $derived(memoryLimit(app.memory))
  const memoryNow = $derived(last(m.memory))
  const share = $derived(memoryShare(memoryNow, app.memory))
  const backupLast = $derived(data.backup && data.backup.last !== 'unavailable' ? data.backup.last : null)
  const backupState = $derived(data.backup ? backupHealth(backupLast) : 'ok')
</script>

<!-- What needs a look comes first; nothing shows when all is well. -->
{#if deploy && !deploy.ok}
  <Alert variant="destructive" class="mb-4">
    <AlertTitle>The deploy of {deploy.tag} failed {ago(deploy.at)}</AlertTitle>
    <AlertDescription>{deploy.error}. {app.tag} keeps running.</AlertDescription>
  </Alert>
{/if}
{#if backupState === 'failed' || backupState === 'overdue'}
  <Alert variant="destructive" class="mb-4">
    <AlertTitle>{backupState === 'failed' ? 'The last backup failed' : 'The backup is overdue'}</AlertTitle>
    <AlertDescription><a href="/{app.name}/backups" class="underline">See backups</a></AlertDescription>
  </Alert>
{/if}

<section aria-labelledby="deployment" class="mb-6 grid border bg-card md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
  <div class="flex items-center justify-center border-b p-8 md:border-r md:border-b-0">
    <AppTile name={app.name} host={app.domain ?? app.hostnames[0]} size="xl" />
  </div>
  <div class="p-4">
    <h2 id="deployment" class="mb-3 text-headline">Deployment</h2>
    <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 text-footnote">
      <dt class="text-muted-foreground">Status</dt>
      <dd class="flex flex-wrap items-center gap-2"><StatusBadge state={app.state} health={app.health} />{#if app.status}<span class="text-muted-foreground">{runningFor(app.status)}</span>{/if}</dd>
      <dt class="text-muted-foreground">Version</dt>
      <dd class="truncate font-mono" title="{app.image}:{app.tag}">{app.image}:{app.tag}</dd>
      <dt class="text-muted-foreground">Deployed</dt>
      <dd>
        {#if deploy?.ok}
          {ago(deploy.at)} <span class="text-muted-foreground">· {dateTime(deploy.at)}</span>
        {:else if deploy?.lastOkAt}
          {ago(deploy.lastOkAt)} <span class="text-muted-foreground">· {dateTime(deploy.lastOkAt)}</span>
        {:else}
          <span class="text-muted-foreground">Not recorded yet: shown after the next deploy</span>
        {/if}
      </dd>
      <dt class="text-muted-foreground">Addresses</dt>
      <dd class="min-w-0 space-y-1">
        {#await data.domain}
          {#each app.hostnames as host (host)}<a href="https://{host}" class="block truncate hover:underline" target="_blank" rel="noopener noreferrer">{host}</a>{/each}
        {:then domain}
          {#each app.hostnames as host (host)}
            {@const status = domain?.hosts.find((h) => h.host === host)}
            <span class="flex min-w-0 items-center gap-2">
              <a href="https://{host}" class="truncate hover:underline" target="_blank" rel="noopener noreferrer">{host}</a>
              {#if status && status.state !== 'active'}<a href="/{app.name}/domains" class="shrink-0 text-caption-1 text-destructive underline">Not live yet</a>{/if}
            </span>
          {/each}
        {/await}
      </dd>
      <dt class="text-muted-foreground">Limits</dt>
      <dd>{limit ? bytes(limit) : app.memory} memory · {app.cpus} CPU</dd>
    </dl>
  </div>
</section>

<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
  <Stat
    label="Uptime"
    value={uptime(m.uptimeDay)}
    detail="{m.up === null ? 'Not probed yet' : m.up === 1 ? 'Reachable now' : 'Not reachable now'} · 7 days: {uptime(m.uptimeWeek)}"
    bad={m.up === 0}
  >
    <UptimeBars series={m.uptimeHourly} ratio={m.uptimeDay ?? undefined} showRatio={false} now={data.now} />
  </Stat>
  <Stat label="Response time" value={milliseconds(last(m.response))} detail={app.protected ? 'Up to the Access sign-in' : 'Full HTTPS request, over the internet'}>
    <Sparkline series={m.response} format={milliseconds} label="Response time, last hour" />
  </Stat>
  <Stat label="CPU" value={percent(last(m.cpu) === null ? null : (last(m.cpu) ?? 0) * 100, 1)} detail="of one core · limit {app.cpus}">
    <Sparkline series={m.cpu.map(([t, v]) => [t, v * 100] as [number, number])} format={(v) => percent(v, 1)} label="CPU, last hour" />
  </Stat>
  <Stat label="Memory" value={bytes(memoryNow)} detail="of {limit ? bytes(limit) : app.memory}" bad={share !== null && share >= MEMORY_TIGHT}>
    <div class="mb-2"><MemoryBar {share} /></div>
    <Sparkline series={m.memory} format={bytes} label="Memory, last hour" />
  </Stat>
</div>

<section aria-labelledby="usage" class="mt-3">
  <h2 id="usage" class="sr-only">Usage</h2>
  {#await data.usage}
    <p class="text-footnote text-muted-foreground">Counting…</p>
  {:then usage}
    {@const visits = usage.visits}
    {@const accounts = usage.accounts}
    {@const requests = usage.requests}
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Visitors"
        value={count(visits?.visitors)}
        detail={visits ? `Last ${visits.days} days · ${count(visits.previous.visitors)} the ${visits.days} before` : app.analytics === false ? 'Analytics is off for this app' : 'Not counted yet'}
      />
      <Stat
        label="Page views"
        value={count(visits?.views)}
        detail={visits ? `${count(visits.visits)} visits · ${count(visits.previous.views)} views the ${visits.days} days before` : 'Pages and app screens'}
      />
      <Stat
        label="Active accounts"
        value={count(accounts?.active.week)}
        detail={accounts ? `Last 7 days · ${count(accounts.active.day)} today · ${count(accounts.active.month)} in 30 days` : 'Accounts in the user pool that use this app'}
      >
        {#if accounts && accounts.newPerDay.length > 1}
          <Sparkline
            series={accounts.newPerDay.map(({ day, count: n }) => [Date.parse(day) / 1000, n] as [number, number])}
            format={(v) => `${count(v)} new`}
            label="New accounts per day, last 30 days"
          />
        {/if}
      </Stat>
      <Stat
        label="Requests"
        value={count(requests.day)}
        detail={requests.day === null ? 'Last 24 hours' : `Last 24 hours · ${percent(requests.day > 0 ? ((requests.errors ?? 0) / requests.day) * 100 : 0, 1)} errors · p95 ${milliseconds(requests.p95)}`}
      >
        <Sparkline series={requests.perHour} format={(v) => `${count(v)} an hour`} label="Requests per hour, last 24 hours" />
      </Stat>
    </div>
  {/await}
</section>
