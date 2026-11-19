<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    label,
    value,
    detail,
    bad = false,
    children,
  }: { label: string; value: string; detail?: string; bad?: boolean; children?: Snippet } = $props()
</script>

<div class="flex flex-col gap-1 border bg-card p-4">
  <p class="text-footnote text-muted-foreground">{label}</p>
  <p class="font-heading text-title-2 font-semibold tabular-nums {bad ? 'text-destructive' : ''}">{value}</p>
  {#if detail}<p class="text-caption-1 text-muted-foreground">{detail}</p>{/if}
  {#if children}<div class="mt-1">{@render children()}</div>{/if}
</div>
