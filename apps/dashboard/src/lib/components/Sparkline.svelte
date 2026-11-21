<script lang="ts">
  import * as Chart from '@spotcraft/ui/components/chart'
  import { LineChart } from 'layerchart'
  import { clock } from '#lib/format.ts'

  interface Props {
    /** [unix seconds, value] points. */
    series: Array<[number, number]>
    format: (value: number) => string
    /** What the line shows, for screen readers. */
    label: string
    /** The period under the line. */
    period?: string
  }

  let { series, format, label, period = 'Last hour' }: Props = $props()

  const data = $derived(series.map(([t, value]) => ({ time: new Date(t * 1000), value })))
  const config = $derived({ value: { label, color: 'var(--primary)' } } satisfies Chart.ChartConfig)
  const summary = $derived(
    series.length
      ? `${label}: now ${format(series[series.length - 1][1])}, peak ${format(Math.max(...series.map(([, v]) => v)))}`
      : `${label}: no data`,
  )
</script>

<div>
  {#if series.length >= 2}
    <p class="sr-only">{summary}</p>
    <Chart.Container {config} class="aspect-auto h-12 w-full" aria-hidden="true">
      <LineChart
        {data}
        x="time"
        series={[{ key: 'value', label, color: 'var(--color-value)' }]}
        axis={false}
        grid={false}
        rule={false}
        padding={{ top: 3, bottom: 3 }}
        props={{ spline: { class: 'stroke-2' } }}
      >
        {#snippet tooltip()}
          <Chart.Tooltip hideIndicator labelFormatter={(d: Date) => clock(d.getTime() / 1000)}>
            {#snippet formatter({ value })}
              <span class="font-medium tabular-nums">{format(Number(value))}</span>
            {/snippet}
          </Chart.Tooltip>
        {/snippet}
      </LineChart>
    </Chart.Container>
    <p class="mt-1 text-xs text-muted-foreground" aria-hidden="true">{period}</p>
  {:else}
    <p class="flex h-12 items-center text-xs text-muted-foreground">No data yet</p>
  {/if}
</div>
