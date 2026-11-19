<script lang="ts">
  import type { Snippet } from 'svelte'
  import { type Row, share } from '#lib/breakdown.ts'
  import { count } from '#lib/format.ts'

  interface Tab {
    label: string
    rows: Row[]
    /** What the numbers are, shown in the header: "Views", "Visitors"… */
    unit: string
    /** Show each row as a share of this total instead of a count. */
    total?: number
    /** How a row's name reads, and anything shown before it (a flag). */
    show?: (name: string) => { text: string; before?: string }
    mono?: boolean
    /** Shown when the tab has no rows. */
    empty?: Snippet
  }

  let { tabs, label }: { tabs: Tab[]; label: string } = $props()

  const SHOWN = 6
  let current = $state(0)
  let all = $state(false)
  const tab = $derived(tabs[current])
  const max = $derived(Math.max(1, ...tab.rows.map((r) => r.count)))
  const rows = $derived(all ? tab.rows : tab.rows.slice(0, SHOWN))
  const id = $props.id()
</script>

<section class="flex min-h-80 flex-col border bg-card" aria-label={label}>
  <div class="flex items-center justify-between gap-4 border-b px-4">
    <div role="tablist" class="flex gap-4">
      {#each tabs as t, i (t.label)}
        <button
          type="button"
          role="tab"
          id="{id}-tab-{i}"
          aria-selected={current === i}
          aria-controls="{id}-panel"
          class="-mb-px min-h-11 border-b-2 text-footnote {current === i ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}"
          onclick={() => {
            current = i
            all = false
          }}
        >{t.label}</button>
      {/each}
    </div>
    <span class="text-caption-1 text-muted-foreground uppercase">{tab.unit}</span>
  </div>

  <div role="tabpanel" id="{id}-panel" aria-labelledby="{id}-tab-{current}" class="flex flex-1 flex-col p-2">
    {#if tab.rows.length}
      <ul class="space-y-1">
        {#each rows as row (row.name)}
          {@const shown = tab.show?.(row.name) ?? { text: row.name }}
          <li class="relative flex min-h-9 items-center justify-between gap-4 px-3 text-footnote">
            <span class="absolute inset-y-0 left-0 bg-muted" style="width: {(row.count / max) * 100}%" aria-hidden="true"></span>
            <span class="relative min-w-0 truncate {tab.mono ? 'font-mono text-caption-1' : ''}" title={shown.text}>
              {#if shown.before}<span class="mr-2" aria-hidden="true">{shown.before}</span>{/if}{shown.text}
            </span>
            <span class="relative font-medium tabular-nums">{tab.total !== undefined ? `${share(row.count, tab.total)}%` : count(row.count)}</span>
          </li>
        {/each}
      </ul>
      {#if tab.rows.length > SHOWN}
        <button type="button" class="mx-auto mt-auto min-h-11 px-4 text-caption-1 text-muted-foreground hover:text-foreground" onclick={() => (all = !all)}>
          {all ? 'Show fewer' : `Show all ${tab.rows.length}`}
        </button>
      {/if}
    {:else}
      <div class="m-auto max-w-xs p-6 text-center">
        {#if tab.empty}{@render tab.empty()}{:else}<p class="text-footnote text-muted-foreground">Nothing counted yet</p>{/if}
      </div>
    {/if}
  </div>
</section>
