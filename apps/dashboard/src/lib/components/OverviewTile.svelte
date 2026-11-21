<script lang="ts">
  let {
    label,
    value,
    detail,
    href,
    bad = false,
  }: { label: string; value: string; detail?: string; href?: string; bad?: boolean } = $props()
</script>

<svelte:element
  this={href ? 'a' : 'div'}
  {href}
  class="flex min-h-11 flex-col gap-1 border bg-card p-4 {href ? 'transition-colors hover:bg-muted' : ''}"
>
  <span class="text-sm text-muted-foreground">{label}</span>
  <span class="font-heading text-xl font-semibold tabular-nums {bad ? 'text-destructive' : ''}">{value}</span>
  {#if detail}<span class="truncate text-xs text-muted-foreground {bad ? 'text-destructive' : ''}">{detail}</span>{/if}
</svelte:element>
