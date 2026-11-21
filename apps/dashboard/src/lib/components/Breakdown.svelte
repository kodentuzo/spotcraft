<script lang="ts">
  import { Button } from '@spotcraft/ui/components/button'
  import * as Card from '@spotcraft/ui/components/card'
  import * as Tabs from '@spotcraft/ui/components/tabs'
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
  let current = $state('0')
  let all = $state(false)
  const tab = $derived(tabs[Number(current)])
  const max = $derived(Math.max(1, ...tab.rows.map((r) => r.count)))
  const rows = $derived(all ? tab.rows : tab.rows.slice(0, SHOWN))
</script>

<section aria-label={label}>
<Card.Root class="h-full min-h-80 gap-0 py-0">
  <Tabs.Root bind:value={current} onValueChange={() => (all = false)} class="flex-1 gap-0">
    <div class="flex items-center justify-between gap-4 border-b px-4">
      <Tabs.List variant="line">
        {#each tabs as t, i (t.label)}
          <Tabs.Trigger value={String(i)}>{t.label}</Tabs.Trigger>
        {/each}
      </Tabs.List>
      <span class="text-xs text-muted-foreground uppercase">{tab.unit}</span>
    </div>

    <Tabs.Content value={current} class="flex flex-1 flex-col p-2">
    {#if tab.rows.length}
      <ul class="space-y-1">
        {#each rows as row (row.name)}
          {@const shown = tab.show?.(row.name) ?? { text: row.name }}
          <li class="relative flex min-h-9 items-center justify-between gap-4 px-3 text-sm">
            <span class="absolute inset-y-0 left-0 bg-muted" style="width: {(row.count / max) * 100}%" aria-hidden="true"></span>
            <span class="relative min-w-0 truncate {tab.mono ? 'font-mono text-xs' : ''}" title={shown.text}>
              {#if shown.before}<span class="mr-2" aria-hidden="true">{shown.before}</span>{/if}{shown.text}
            </span>
            <span class="relative font-medium tabular-nums">{tab.total !== undefined ? `${share(row.count, tab.total)}%` : count(row.count)}</span>
          </li>
        {/each}
      </ul>
      {#if tab.rows.length > SHOWN}
        <Button variant="ghost" size="sm" class="mx-auto mt-auto text-xs text-muted-foreground" onclick={() => (all = !all)}>
          {all ? 'Show fewer' : `Show all ${tab.rows.length}`}
        </Button>
      {/if}
    {:else}
      <div class="m-auto max-w-xs p-6 text-center">
        {#if tab.empty}{@render tab.empty()}{:else}<p class="text-sm text-muted-foreground">Nothing counted yet</p>{/if}
      </div>
    {/if}
      </Tabs.Content>
  </Tabs.Root>
</Card.Root>
</section>
