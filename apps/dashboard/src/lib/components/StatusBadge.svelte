<script lang="ts">
  import { Badge } from '@spotcraft/ui/components/badge'
  import { statusView } from '#lib/status.ts'

  let { state, health }: { state: string; health: string } = $props()

  const view = $derived(statusView(state, health))
</script>

<Badge variant={view.bad ? 'destructive' : 'secondary'}>{view.label}</Badge>
