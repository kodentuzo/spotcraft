<script lang="ts">
  import * as Card from '@spotcraft/ui/components/card'
  import type { Snippet } from 'svelte'

  let {
    label,
    value,
    detail,
    bad = false,
    children,
  }: { label: string; value: string; detail?: string; bad?: boolean; children?: Snippet } = $props()
</script>

<Card.Root size="sm">
  <Card.Content class="flex flex-col gap-1">
  <p class="text-sm text-muted-foreground">{label}</p>
  <p class="font-heading text-xl font-semibold tabular-nums {bad ? 'text-destructive' : ''}">{value}</p>
  {#if detail}<p class="text-xs text-muted-foreground">{detail}</p>{/if}
  {#if children}<div class="mt-1">{@render children()}</div>{/if}
  </Card.Content>
</Card.Root>
