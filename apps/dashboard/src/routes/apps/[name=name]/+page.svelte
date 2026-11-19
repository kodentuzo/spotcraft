<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import { Button } from '@spotcraft/ui/components/button'
  import AppTile from '#lib/components/AppTile.svelte'
  import StatusBadge from '#lib/components/StatusBadge.svelte'
  import { enhance } from '$app/forms'
  import { page } from '$app/state'
  import type { PageProps } from './$types'
  import Overview from './Overview.svelte'
  import Settings from './Settings.svelte'
  import Usage from './Usage.svelte'

  let { data, form }: PageProps = $props()

  const app = $derived(data.app)
  const host = $derived(app.domain ?? app.hostnames[0])
  let redeploying = $state(false)

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'usage', label: 'Usage' },
    { id: 'settings', label: 'Settings' },
    { id: 'logs', label: 'Logs' },
  ] as const
  type Tab = (typeof tabs)[number]['id']
  // A form's result belongs to the Settings tab, even when the browser posted without the tab.
  const tab = $derived.by((): Tab => {
    const asked = page.url.searchParams.get('tab')
    if (tabs.some((t) => t.id === asked)) return asked as Tab
    if (form && !('deployError' in form) && !('redeployed' in form)) return 'settings'
    return 'overview'
  })
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

<nav aria-label="App sections" class="mb-6 flex overflow-x-auto border-b">
  {#each tabs as t (t.id)}
    <a
      href={t.id === 'overview' ? `/apps/${app.name}` : `?tab=${t.id}`}
      data-sveltekit-noscroll
      aria-current={tab === t.id ? 'page' : undefined}
      class="-mb-px flex min-h-11 items-center border-b-2 px-4 text-footnote whitespace-nowrap {tab === t.id ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}"
    >{t.label}</a>
  {/each}
</nav>

{#if tab === 'overview'}
  <Overview {data} />
{:else if tab === 'usage'}
  <Usage {data} />
{:else if tab === 'settings'}
  <Settings {data} {form} />
{:else}
  <section>
    <h2 class="sr-only">Logs</h2>
    <p class="mb-2 text-caption-1 text-muted-foreground">Last 200 lines, newest at the bottom. Reload the page for newer lines.</p>
    <pre class="max-h-[40rem] overflow-auto border bg-muted p-4 text-xs leading-relaxed whitespace-pre-wrap">{data.logs || 'No logs yet.'}</pre>
  </section>
{/if}
