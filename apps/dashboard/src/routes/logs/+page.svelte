<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  const time = (iso: string) => (iso ? iso.slice(11, 19) : '')
</script>

<svelte:head><title>Logs · Spotcraft</title></svelte:head>

<h1 class="mb-1 font-heading text-title-1 font-bold">Logs</h1>
{#if data.agentError}
  <Alert variant="destructive" class="mt-4"><AlertTitle>Can't reach the agent</AlertTitle><AlertDescription>{data.agentError}.</AlertDescription></Alert>
{:else if data.apps.length === 0}
  <p class="text-footnote text-muted-foreground">No apps yet.</p>
{:else}
  <p class="mb-4 text-footnote text-muted-foreground">
    Every app's latest lines, merged by time (UTC), newest at the bottom. Pick an app in the switcher for all of its own; reload for newer lines.
  </p>
  <div class="max-h-[70dvh] overflow-auto border bg-muted p-4 font-mono text-xs leading-relaxed">
    {#each data.lines as line, i (i)}
      <div class="grid grid-cols-[4.5rem_8rem_minmax(0,1fr)] gap-3">
        <span class="text-muted-foreground tabular-nums">{time(line.at)}</span>
        <a href="/logs/{line.app}" class="truncate text-muted-foreground hover:text-foreground">{line.app}</a>
        <span class="break-words whitespace-pre-wrap">{line.text}</span>
      </div>
    {:else}
      <p class="text-muted-foreground">No logs yet.</p>
    {/each}
  </div>
{/if}
