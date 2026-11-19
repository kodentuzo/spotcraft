<script lang="ts">
  import { clock, uptime } from '#lib/format.ts'
  import { hourlyBars } from '#lib/overview.ts'

  interface Props {
    /** [unix seconds, ratio] per hour. */
    series: Array<[number, number]>
    /** Over the whole 24 hours. */
    ratio: number | undefined
    /** Repeat the ratio under the bars; off where it is already shown. */
    showRatio?: boolean
    /** When the page was made (ms): the server's time, so the browser draws the same hours. */
    now: number
  }

  let { series, ratio, showRatio = true, now }: Props = $props()

  const bars = $derived(hourlyBars(series, now / 1000))
  const down = $derived(bars.filter((bar) => bar.ratio !== null && bar.ratio < 0.999).length)
  const summary = $derived(
    series.length === 0
      ? 'No uptime data yet'
      : `Uptime ${uptime(ratio)} over 24 hours; ${down === 0 ? 'no hour with downtime' : `${down} ${down === 1 ? 'hour' : 'hours'} with downtime`}`,
  )
</script>

<div>
  <div class="flex h-6 items-end gap-px" role="img" aria-label={summary}>
    {#each bars as bar (bar.at)}
      <span
        class="h-full flex-1 {bar.ratio === null ? 'bg-muted' : bar.ratio < 0.999 ? 'bg-destructive' : 'bg-muted-foreground/60'}"
        title="{clock(bar.at)} · {bar.ratio === null ? 'no data' : uptime(bar.ratio)}"
      ></span>
    {/each}
  </div>
  <p class="mt-1 whitespace-nowrap text-caption-1 text-muted-foreground tabular-nums" aria-hidden="true">
    {#if showRatio}{uptime(ratio)}{/if}{#if down > 0}<span class="text-destructive">{`${showRatio ? ' · ' : ''}${down} h down`}</span>{/if}
  </p>
</div>
