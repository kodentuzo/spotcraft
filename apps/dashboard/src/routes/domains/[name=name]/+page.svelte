<script lang="ts">
  import { Button } from '@spotcraft/ui/components/button'
  import AppHeading from '#lib/components/AppHeading.svelte'
  import DomainHosts from '#lib/components/DomainHosts.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Domains · {data.app.name} · Spotcraft</title></svelte:head>

<AppHeading title="Domains" app={data.app}>
  <Button href="/apps/{data.app.name}/edit" variant="outline">Change domain</Button>
</AppHeading>

<ul class="space-y-3">
  {#each data.own as host (host)}
    <li class="flex flex-wrap items-center justify-between gap-2 border bg-card p-4 text-footnote">
      <a href="https://{host}" class="font-mono hover:underline" target="_blank" rel="noopener noreferrer">{host}</a>
      <span class="text-xs text-muted-foreground">Spotcraft subdomain</span>
    </li>
  {/each}
</ul>
{#if data.custom}
  {#await data.custom}
    <p class="mt-3 text-footnote text-muted-foreground">Checking {data.app.domain}…</p>
  {:then status}
    {#if status?.hosts.length}
      <div class="mt-3"><DomainHosts hosts={status.hosts} /></div>
    {:else}
      <p class="mt-3 text-footnote text-muted-foreground">{data.app.domain}: status unavailable</p>
    {/if}
  {/await}
{:else}
  <p class="mt-3 text-footnote text-muted-foreground">No custom domain. Add one from the app's Edit page.</p>
{/if}
