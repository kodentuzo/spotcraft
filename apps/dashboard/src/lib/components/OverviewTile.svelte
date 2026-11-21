<script lang="ts">
  import * as Card from '@spotcraft/ui/components/card'

  let {
    label,
    value,
    detail,
    href,
    bad = false,
  }: { label: string; value: string; detail?: string; href?: string; bad?: boolean } = $props()
</script>

<svelte:element this={href ? 'a' : 'div'} {href} class="group block">
  <Card.Root size="sm" class="h-full {href ? 'transition-colors group-hover:bg-muted' : ''}">
    <Card.Content class="flex flex-col gap-1">
      <span class="text-sm text-muted-foreground">{label}</span>
      <span class="font-heading text-xl font-semibold tabular-nums {bad ? 'text-destructive' : ''}">{value}</span>
      {#if detail}<span class="truncate text-xs text-muted-foreground {bad ? 'text-destructive' : ''}">{detail}</span>{/if}
    </Card.Content>
  </Card.Root>
</svelte:element>
