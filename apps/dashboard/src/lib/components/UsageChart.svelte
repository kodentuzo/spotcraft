<script lang="ts">
  import { Badge } from '@spotcraft/ui/components/badge'
  import * as Card from '@spotcraft/ui/components/card'
  import * as Chart from '@spotcraft/ui/components/chart'
  import * as Tabs from '@spotcraft/ui/components/tabs'
  import { AreaChart } from 'layerchart'
  import { axis, type DayPoint, dayLabel } from '#lib/usage.ts'

  interface Tab {
    label: string
    /** The total for the period, already formatted. */
    value: string
    /** Change from the period before, in percent; null when there is nothing to compare. */
    change: number | null
    points: DayPoint[]
    /** "3 visitors" for a point. */
    format: (value: number) => string
    /** What the line shows, under the chart. */
    note: string
  }

  let { tabs }: { tabs: Tab[] } = $props()

  let current = $state('0')
  const tab = $derived(tabs[Number(current)])

  const data = $derived(tab.points.map((p) => ({ date: new Date(`${p.day}T00:00:00Z`), value: p.value })))
  const config = $derived({ value: { label: tab.label, color: 'var(--primary)' } } satisfies Chart.ChartConfig)
  const top = $derived(axis(Math.max(0, ...tab.points.map((p) => p.value))).top)
  const summary = $derived(
    `${tab.label}: ${tab.points.map((p) => `${dayLabel(p.day)} ${tab.format(p.value)}`).join(', ')}`,
  )
</script>

<Card.Root class="gap-0 py-0">
  <Tabs.Root bind:value={current} class="gap-0" aria-label="Usage over the last 7 days">
    <Tabs.List variant="line" class="usage-tabs grid w-full group-data-horizontal/tabs:h-auto grid-cols-2 gap-0 border-b p-0" style="--tabs: {tabs.length}">
      {#each tabs as t, i (t.label)}
        <Tabs.Trigger value={String(i)} class="h-auto flex-col items-start gap-1 rounded-none p-4 text-left data-active:bg-muted {i > 0 ? 'md:border-l md:border-l-border' : ''}">
          <span class="text-sm font-normal text-muted-foreground">{t.label}</span>
          <span class="flex items-center gap-2">
            <span class="font-heading text-2xl font-semibold text-foreground tabular-nums">{t.value}</span>
            {#if t.change !== null}
              <Badge variant={t.change < 0 ? 'destructive' : 'secondary'} class="tabular-nums">{t.change > 0 ? '+' : ''}{t.change}%</Badge>
            {/if}
          </span>
        </Tabs.Trigger>
      {/each}
    </Tabs.List>

    <Tabs.Content value={current} class="p-4">
      <p class="mb-3 text-xs text-muted-foreground">{tab.note}</p>
      <p class="sr-only">{summary}</p>
      <Chart.Container config={config} class="aspect-auto h-56 w-full" aria-hidden="true">
        <AreaChart
          {data}
          x="date"
          yDomain={[0, top]}
          series={[{ key: 'value', label: tab.label, color: 'var(--color-value)' }]}
          props={{
            area: { fillOpacity: 0.08, line: { class: 'stroke-2' } },
            xAxis: { format: (d: Date) => dayLabel(d.toISOString().slice(0, 10)), ticks: data.length > 7 ? 7 : data.length },
            yAxis: { ticks: 3 },
          }}
        >
          {#snippet tooltip()}
            <Chart.Tooltip hideIndicator labelFormatter={(d: Date) => dayLabel(d.toISOString().slice(0, 10))}>
              {#snippet formatter({ value })}
                <span class="font-medium tabular-nums">{tab.format(Number(value))}</span>
              {/snippet}
            </Chart.Tooltip>
          {/snippet}
        </AreaChart>
      </Chart.Container>
    </Tabs.Content>
  </Tabs.Root>
</Card.Root>

<style>
  @media (width >= 48rem) {
    :global(.usage-tabs) {
      grid-template-columns: repeat(var(--tabs), minmax(0, 1fr));
    }
  }
</style>
