<script lang="ts">
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
    /** The last point is today, still counting: its segment is dashed. */
    partialLast?: boolean
  }

  let { tabs }: { tabs: Tab[] } = $props()

  let current = $state(0)
  let hover = $state<number | null>(null)
  const tab = $derived(tabs[current])
  const id = $props.id()

  const W = 800
  const H = 220
  const scale = $derived(axis(Math.max(0, ...tab.points.map((p) => p.value))))
  const ticks = $derived(
    Array.from({ length: Math.round(scale.top / scale.step) + 1 }, (_, i) => i * scale.step).reverse(),
  )
  const x = (i: number) => (tab.points.length > 1 ? (i / (tab.points.length - 1)) * W : W / 2)
  const y = (v: number) => H - (v / scale.top) * H
  const coords = $derived(tab.points.map((p, i) => [x(i), y(p.value)] as const))
  const path = (pts: ReadonlyArray<readonly [number, number]>) =>
    pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
  const solid = $derived(tab.partialLast && coords.length > 2 ? coords.slice(0, -1) : coords)
  const dashed = $derived(tab.partialLast && coords.length > 2 ? coords.slice(-2) : [])
  const area = $derived(coords.length > 1 ? `${path(coords)}L${W},${H}L0,${H}Z` : '')
  const summary = $derived(
    `${tab.label}: ${tab.points.map((p) => `${dayLabel(p.day)} ${tab.format(p.value)}`).join(', ')}`,
  )

  function onpointermove(event: PointerEvent) {
    if (tab.points.length === 0) return
    const box = (event.currentTarget as SVGElement).getBoundingClientRect()
    const share = (event.clientX - box.left) / box.width
    hover = Math.max(0, Math.min(tab.points.length - 1, Math.round(share * (tab.points.length - 1))))
  }
</script>

<section class="border bg-card" aria-label="Usage over the last 7 days">
  <div role="tablist" class="tabs grid grid-cols-2 border-b" style="--tabs: {tabs.length}">
    {#each tabs as t, i (t.label)}
      <button
        type="button"
        role="tab"
        id="{id}-tab-{i}"
        aria-selected={current === i}
        aria-controls="{id}-panel"
        class="flex min-h-11 flex-col items-start gap-1 border-b-2 p-4 text-left transition-colors {current === i ? 'border-foreground bg-raised' : 'border-transparent hover:bg-raised/60'} {i > 0 ? 'md:border-l md:border-l-border' : ''}"
        onclick={() => {
          current = i
          hover = null
        }}
      >
        <span class="text-footnote text-muted-foreground">{t.label}</span>
        <span class="flex items-center gap-2">
          <span class="font-heading text-title-1 font-semibold tabular-nums">{t.value}</span>
          {#if t.change !== null}
            <span class="px-1.5 py-0.5 text-caption-1 font-medium tabular-nums {t.change < 0 ? 'bg-destructive/15 text-destructive' : 'bg-muted text-foreground'}">
              {t.change > 0 ? '+' : ''}{t.change}%
            </span>
          {/if}
        </span>
      </button>
    {/each}
  </div>

  <div role="tabpanel" id="{id}-panel" aria-labelledby="{id}-tab-{current}" class="p-4">
    <p class="mb-3 h-4 text-caption-1 text-muted-foreground tabular-nums" aria-live="polite">
      {#if hover !== null && tab.points[hover]}{dayLabel(tab.points[hover].day)} · {tab.format(tab.points[hover].value)}{:else}{tab.note}{/if}
    </p>
    <div class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
      <div class="relative h-56 text-caption-1 text-muted-foreground tabular-nums" aria-hidden="true">
        {#each ticks as tick (tick)}
          <span class="absolute right-0 -translate-y-1/2" style="top: {(1 - tick / scale.top) * 100}%">{tick}</span>
        {/each}
        <span class="invisible">{scale.top}</span>
      </div>
      <div class="relative">
      <svg
        viewBox="0 0 {W} {H}"
        preserveAspectRatio="none"
        class="h-56 w-full overflow-visible text-foreground"
        role="img"
        aria-label={summary}
        {onpointermove}
        onpointerleave={() => (hover = null)}
      >
        {#each ticks as tick (tick)}
          <line x1="0" x2={W} y1={y(tick)} y2={y(tick)} class="stroke-border" stroke-width="1" vector-effect="non-scaling-stroke" />
        {/each}
        {#if area}<path d={area} fill="currentColor" fill-opacity="0.06" />{/if}
        <path d={path(solid)} fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
        {#if dashed.length}
          <path d={path(dashed)} fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 5" vector-effect="non-scaling-stroke" />
        {/if}
        {#if hover !== null && coords[hover]}
          <line x1={coords[hover][0]} x2={coords[hover][0]} y1="0" y2={H} class="stroke-muted-foreground" stroke-width="1" vector-effect="non-scaling-stroke" />
        {/if}
      </svg>
      <!-- In HTML, not the stretched SVG, so the dot stays round. -->
      {#if hover !== null && coords[hover]}
        <span
          class="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground"
          style="left: {(coords[hover][0] / W) * 100}%; top: {(coords[hover][1] / H) * 100}%"
          aria-hidden="true"
        ></span>
      {/if}
      </div>
      <span></span>
      <!-- Each label sits under its point; the first and last keep inside the chart. A phone shows
           every third, so they don't overlap. -->
      <div class="relative mt-2 h-4 text-caption-1 text-muted-foreground" aria-hidden="true">
        {#each tab.points as point, i (point.day)}
          {@const at = (x(i) / W) * 100}
          <span
            class="absolute whitespace-nowrap {i === 0 ? '' : i === tab.points.length - 1 ? '-translate-x-full' : '-translate-x-1/2'} {i % 3 === 0 || i === tab.points.length - 1 ? '' : 'hidden sm:inline'}"
            style="left: {at}%"
          >{dayLabel(point.day)}</span>
        {/each}
      </div>
    </div>
  </div>
</section>

<style>
  @media (width >= 48rem) {
    .tabs {
      grid-template-columns: repeat(var(--tabs), minmax(0, 1fr));
    }
  }
</style>
