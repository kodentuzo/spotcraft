<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import { Button } from '@spotcraft/ui/components/button'
  import AppTile from '#lib/components/AppTile.svelte'
  import StatusBadge from '#lib/components/StatusBadge.svelte'
  import { enhance } from '$app/forms'
  import type { PageProps } from './$types'
  import Overview from './Overview.svelte'

  let { data, form }: PageProps = $props()

  const app = $derived(data.app)
  const host = $derived(app.domain ?? app.hostnames[0])
  let redeploying = $state(false)

</script>

<svelte:head><title>{app.name} · Spotcraft</title></svelte:head>

<a href="/" class="text-footnote text-muted-foreground hover:text-foreground">← Apps</a>

<header class="mt-3 mb-6 flex flex-wrap items-center justify-between gap-4">
  <div class="flex min-w-0 items-center gap-4">
    <AppTile name={app.name} {host} size="lg" />
    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="font-heading text-title-1 font-bold">{app.name}</h1>
        <StatusBadge state={app.state} health={app.health} />
      </div>
      {#if host}
        <a href="https://{host}" class="block truncate text-footnote text-muted-foreground hover:text-foreground hover:underline" target="_blank" rel="noopener noreferrer">{host}</a>
      {/if}
    </div>
  </div>
  <div class="flex gap-2">
    <form
      method="POST"
      action="?/redeploy"
      use:enhance={() => {
        redeploying = true
        return async ({ update }) => {
          await update()
          redeploying = false
        }
      }}
    >
      <Button type="submit" variant="outline" disabled={redeploying}>{redeploying ? 'Redeploying…' : 'Redeploy'}</Button>
    </form>
    <Button href="/apps/{app.name}/edit" variant="outline">Edit</Button>
    {#if host}<Button href="https://{host}" target="_blank" rel="noopener noreferrer">Visit</Button>{/if}
  </div>
</header>

{#if form && 'deployError' in form}
  <Alert variant="destructive" class="mb-6">
    <AlertTitle>Redeploy failed</AlertTitle>
    <AlertDescription>
      <p>{form.deployError}. The previous version is still running.</p>
      {#if form.output}<pre class="mt-2 max-h-64 overflow-auto text-xs whitespace-pre-wrap">{form.output}</pre>{/if}
    </AlertDescription>
  </Alert>
{:else if form && 'redeployed' in form}
  <Alert class="mb-6"><AlertTitle>Redeployed</AlertTitle></Alert>
{/if}

<Overview {data} />
