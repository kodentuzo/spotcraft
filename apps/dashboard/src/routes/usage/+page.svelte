<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import AppTile from '#lib/components/AppTile.svelte'
  import UsageChart from '#lib/components/UsageChart.svelte'
  import { count } from '#lib/format.ts'
  import { change, lastDays, sumDays } from '#lib/usage.ts'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  const week = $derived(lastDays(7, data.now))
  const total = (pick: (app: (typeof data.apps)[number]) => number | null | undefined) =>
    data.apps.reduce<number | null>((sum, app) => {
      const n = pick(app)
      return n === null || n === undefined ? sum : (sum ?? 0) + n
    }, null)
  const visitors = $derived(total((a) => a.visits?.visitors))
  const views = $derived(total((a) => a.visits?.views))
  const requests = $derived(total((a) => a.requests.week))
  const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`
</script>

<svelte:head><title>Usage · Spotcraft</title></svelte:head>

<h1 class="mb-1 font-heading text-title-1 font-bold">Usage</h1>
<p class="mb-6 text-footnote text-muted-foreground">Every app together, over the last 7 days. Each app's page breaks its own down.</p>

{#if data.agentError}
  <Alert variant="destructive"><AlertTitle>Can't reach the agent</AlertTitle><AlertDescription>{data.agentError}.</AlertDescription></Alert>
{:else}
  <UsageChart
    tabs={[
      {
        label: 'Visitors',
        value: count(visitors),
        change: change(visitors, total((a) => a.visits?.previous.visitors)),
        points: sumDays(week, data.apps.map((a) => (a.visits?.perDay ?? []).map((d) => ({ day: d.day, value: d.visitors })))),
        format: (v) => plural(v, 'visitor', 'visitors'),
        note: 'Visitors per day, all apps (UTC); today is still counting',
        partialLast: true,
      },
      {
        label: 'Page views',
        value: count(views),
        change: change(views, total((a) => a.visits?.previous.views)),
        points: sumDays(week, data.apps.map((a) => (a.visits?.perDay ?? []).map((d) => ({ day: d.day, value: d.views })))),
        format: (v) => plural(v, 'view', 'views'),
        note: 'Pages and app screens per day, all apps',
        partialLast: true,
      },
      {
        label: 'Requests',
        value: count(requests),
        change: change(requests, total((a) => a.requests.previousWeek)),
        points: sumDays(lastDays(7, data.now), data.apps.flatMap((a) => a.requests.perDay)),
        format: (v) => plural(v, 'request', 'requests'),
        note: 'Requests per day to every app, each point the 24 hours before it',
      },
    ]}
  />

  <div class="mt-3 border bg-card">
    <div class="hidden gap-6 border-b px-4 py-2 text-caption-1 text-muted-foreground md:flex" aria-hidden="true">
      <span class="flex-1">App</span>
      <span class="grid w-96 shrink-0 grid-cols-3 gap-4 text-right"><span>Visitors</span><span>Page views</span><span>Requests</span></span>
    </div>
    <ul class="divide-y">
      {#each data.apps as app (app.name)}
        {@const visitorsChange = change(app.visits?.visitors, app.visits?.previous.visitors)}
        <li class="relative flex flex-col gap-3 p-4 hover:bg-raised md:flex-row md:items-center md:gap-6">
          <div class="flex min-w-0 flex-1 items-center gap-3">
            <AppTile name={app.name} host={app.host} />
            <a href="/{app.name}/usage" class="truncate text-headline after:absolute after:inset-0">{app.name}</a>
          </div>
          <dl class="grid grid-cols-3 gap-4 md:w-96 md:shrink-0 md:text-right">
            <div>
              <dt class="text-caption-1 text-muted-foreground md:sr-only">Visitors</dt>
              <dd class="text-headline tabular-nums">
                {count(app.visits?.visitors)}{#if visitorsChange !== null}<span class="ml-1 text-caption-1 {visitorsChange < 0 ? 'text-destructive' : 'text-muted-foreground'}">{visitorsChange > 0 ? '+' : ''}{visitorsChange}%</span>{/if}
              </dd>
            </div>
            <div>
              <dt class="text-caption-1 text-muted-foreground md:sr-only">Page views</dt>
              <dd class="text-headline tabular-nums">{count(app.visits?.views)}</dd>
            </div>
            <div>
              <dt class="text-caption-1 text-muted-foreground md:sr-only">Requests</dt>
              <dd class="text-headline tabular-nums">{count(app.requests.week)}</dd>
            </div>
          </dl>
        </li>
      {/each}
    </ul>
  </div>
{/if}
