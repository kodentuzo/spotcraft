<script lang="ts">
  import AppHeading from '#lib/components/AppHeading.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Logs · {data.app.name} · Spotcraft</title></svelte:head>

<AppHeading title="Logs" app={data.app} />
<p class="mb-2 text-xs text-muted-foreground">The last 200 lines, newest at the bottom. Reload the page for newer lines.</p>
<pre class="max-h-[70dvh] overflow-auto border bg-muted p-4 text-xs leading-relaxed whitespace-pre-wrap">{data.logs || 'No logs yet.'}</pre>
