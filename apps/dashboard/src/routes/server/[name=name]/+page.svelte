<script lang="ts">
  import AppHeading from '#lib/components/AppHeading.svelte'
  import MemoryBar from '#lib/components/MemoryBar.svelte'
  import Sparkline from '#lib/components/Sparkline.svelte'
  import Stat from '#lib/components/Stat.svelte'
  import UptimeBars from '#lib/components/UptimeBars.svelte'
  import { bytes, milliseconds, percent, uptime } from '#lib/format.ts'
  import { MEMORY_TIGHT, memoryLimit, memoryShare } from '#lib/overview.ts'
  import { runningFor } from '#lib/status.ts'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  const app = $derived(data.app)
  const h = $derived(data.health)
  const last = (series: Array<[number, number]>) => (series.length ? series[series.length - 1][1] : null)
  const peak = (series: Array<[number, number]>) => (series.length ? Math.max(...series.map(([, v]) => v)) : null)
  const limit = $derived(memoryLimit(app.memory))
  const share = $derived(memoryShare(last(h.memory), app.memory))
</script>

<svelte:head><title>Server · {app.name} · Spotcraft</title></svelte:head>

<AppHeading title="Server" {app} />

<div class="grid gap-3 sm:grid-cols-2">
  <Stat label="CPU" value={percent(last(h.cpu) === null ? null : (last(h.cpu) ?? 0) * 100, 1)} detail="of one core · limit {app.cpus} · peak {percent((peak(h.cpu) ?? 0) * 100, 1)} today">
    <Sparkline series={h.cpu.map(([t, v]) => [t, v * 100] as [number, number])} format={(v) => percent(v, 1)} label="CPU, last 24 hours" period="Last 24 hours" />
  </Stat>
  <Stat label="Memory" value={bytes(last(h.memory))} detail="of {limit ? bytes(limit) : app.memory} · peak {bytes(peak(h.memory))} today" bad={share !== null && share >= MEMORY_TIGHT}>
    <div class="mb-2"><MemoryBar {share} /></div>
    <Sparkline series={h.memory} format={bytes} label="Memory, last 24 hours" period="Last 24 hours" />
  </Stat>
  <Stat label="Response time" value={milliseconds(last(h.response))} detail={app.protected ? 'Up to the Access sign-in' : 'Full HTTPS request, over the internet'}>
    <Sparkline series={h.response} format={milliseconds} label="Response time, last 24 hours" period="Last 24 hours" />
  </Stat>
  <Stat label="Uptime" value={uptime(h.uptimeDay)} detail="{h.up === null ? 'Not probed yet' : h.up === 1 ? 'Reachable now' : 'Not reachable now'} · 7 days: {uptime(h.uptimeWeek)}" bad={h.up === 0}>
    <UptimeBars series={h.uptimeHourly} ratio={h.uptimeDay ?? undefined} showRatio={false} now={data.now} />
  </Stat>
</div>

<section class="mt-3 border bg-card p-4 text-footnote" aria-labelledby="container">
  <h2 id="container" class="mb-3 text-headline">Container</h2>
  <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-2">
    <dt class="text-muted-foreground">State</dt><dd>{app.state}{#if app.status} · {runningFor(app.status)}{/if}</dd>
    <dt class="text-muted-foreground">Image</dt><dd class="truncate font-mono">{app.image}:{app.tag}</dd>
    <dt class="text-muted-foreground">Limits</dt><dd>{limit ? bytes(limit) : app.memory} memory · {app.cpus} CPU</dd>
    <dt class="text-muted-foreground">Port</dt><dd class="tabular-nums">{app.port}</dd>
    <dt class="text-muted-foreground">Filesystem</dt><dd>{app.readOnly ? 'Read-only, with a writable /tmp' : 'Writable'}</dd>
  </dl>
</section>
