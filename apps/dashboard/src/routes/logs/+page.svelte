<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Logs · Spotcraft</title></svelte:head>

<h1 class="mb-1 font-heading text-title-1 font-bold">Logs</h1>
{#if data.agentError}
  <Alert variant="destructive" class="mt-4"><AlertTitle>Can't reach the agent</AlertTitle><AlertDescription>{data.agentError}.</AlertDescription></Alert>
{:else if !data.app}
  <p class="text-footnote text-muted-foreground">No apps yet.</p>
{:else}
  <p class="mb-4 text-footnote text-muted-foreground">
    <a href="/apps/{data.app}" class="font-medium text-foreground hover:underline">{data.app}</a>: the last 200 lines, newest at the
    bottom. Pick another app in the switcher above; reload for newer lines.
  </p>
  <nav aria-label="Apps" class="mb-3 flex flex-wrap gap-1">
    {#each data.apps as name (name)}
      <a
        href="?app={name}"
        aria-current={name === data.app ? 'page' : undefined}
        class="min-h-9 border px-3 py-1.5 text-footnote {name === data.app ? 'border-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}"
      >{name}</a>
    {/each}
  </nav>
  <pre class="max-h-[70dvh] overflow-auto border bg-muted p-4 text-xs leading-relaxed whitespace-pre-wrap">{data.logs || 'No logs yet.'}</pre>
{/if}
