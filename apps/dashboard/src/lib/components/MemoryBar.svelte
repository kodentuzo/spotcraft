<script lang="ts">
  import { MEMORY_TIGHT } from '#lib/overview.ts'

  /** Share of the limit in use, 0–1; null draws an empty track. */
  let { share }: { share: number | null } = $props()
</script>

<div class="h-1 bg-muted" aria-hidden="true">
  {#if share !== null}
    <div class="h-full {share >= MEMORY_TIGHT ? 'bg-destructive' : 'bg-muted-foreground/60'}" style="width: {Math.min(100, share * 100)}%"></div>
  {/if}
</div>
