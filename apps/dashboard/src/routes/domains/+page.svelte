<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import * as Card from '@spotcraft/ui/components/card'
  import AppTile from '#lib/components/AppTile.svelte'
  import DomainHosts from '#lib/components/DomainHosts.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Domains · Spotcraft</title></svelte:head>

<h1 class="mb-1 font-heading text-2xl font-bold">Domains</h1>
<p class="mb-6 text-sm text-muted-foreground">Every address an app answers on. Change an app's domain from its Edit page.</p>

{#if data.agentError}
  <Alert variant="destructive"><AlertTitle>Can't reach the agent</AlertTitle><AlertDescription>{data.agentError}.</AlertDescription></Alert>
{:else if data.apps.length === 0}
  <p class="text-sm text-muted-foreground">No apps yet.</p>
{:else}
  <div class="space-y-6">
    {#each data.apps as app (app.name)}
      {@const custom = data.custom[app.name]}
      <section aria-labelledby="domain-{app.name}">
        <div class="mb-2 flex items-center gap-3">
          <AppTile name={app.name} host={app.domain ?? app.hostnames[0]} />
          <h2 id="domain-{app.name}" class="text-base font-semibold"><a href="/{app.name}/domains" class="hover:underline">{app.name}</a></h2>
        </div>
        <ul class="space-y-3">
          {#each app.own as host (host)}
            <li><Card.Root size="sm"><Card.Content class="flex flex-wrap items-center justify-between gap-2 text-sm">
              <a href="https://{host}" class="font-mono hover:underline" target="_blank" rel="noopener noreferrer">{host}</a>
              <span class="text-xs text-muted-foreground">Spotcraft subdomain</span>
            </Card.Content></Card.Root></li>
          {/each}
        </ul>
        {#if custom}
          {#await custom}
            <p class="mt-3 text-sm text-muted-foreground">Checking {app.domain}…</p>
          {:then status}
            {#if status?.hosts.length}
              <div class="mt-3"><DomainHosts hosts={status.hosts} /></div>
            {:else}
              <p class="mt-3 text-sm text-muted-foreground">{app.domain}: status unavailable</p>
            {/if}
          {/await}
        {/if}
      </section>
    {/each}
  </div>
{/if}
