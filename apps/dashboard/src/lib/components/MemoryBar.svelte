<script lang="ts">
  import { Progress } from '@spotcraft/ui/components/progress'
  import { MEMORY_TIGHT } from '#lib/overview.ts'

  /** Share of the limit in use, 0–1; null draws an empty track. */
  let { share }: { share: number | null } = $props()
</script>

<Progress
  value={share === null ? 0 : Math.min(100, share * 100)}
  aria-hidden="true"
  class="h-1 rounded-none {share !== null && share >= MEMORY_TIGHT ? '[&>[data-slot=progress-indicator]]:bg-destructive' : '[&>[data-slot=progress-indicator]]:bg-muted-foreground/60'}"
/>
