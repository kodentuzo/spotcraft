<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import { Button } from '@spotcraft/ui/components/button'
  import { backupHealth } from '#lib/backup.ts'
  import AppRow from '#lib/components/AppRow.svelte'
  import OverviewTile from '#lib/components/OverviewTile.svelte'
  import { bytes, percent } from '#lib/format.ts'
  import { troubled } from '#lib/overview.ts'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  const backups = $derived(data.backups && data.backups !== 'unavailable' ? data.backups : null)
  const down = $derived(troubled(data.apps))
  const unbacked = $derived(
    backups ? data.apps.filter((app) => backupHealth(backups[app.name]) !== 'ok').map((app) => app.name) : [],
  )
  const s = $derived(data.server)
</script>

<svelte:head><title>Apps · Spotcraft</title></svelte:head>

<div class="mb-6 flex items-center justify-between gap-4">
  <h1 class="font-heading text-title-1 font-bold">Apps</h1>
  <Button href="/apps/new">Add app</Button>
</div>

<section aria-label="Overview" class="mb-8 grid grid-cols-2 gap-3 {backups ? 'md:grid-cols-4' : 'md:grid-cols-3'}">
  {#if !data.agentError}
    <OverviewTile
      label="Apps"
      value={data.apps.length === 0 ? '0' : `${data.apps.length - down.length} of ${data.apps.length}`}
      detail={down.length ? `Needs a look: ${down.join(', ')}` : data.apps.length ? 'All running' : 'None yet'}
      bad={down.length > 0}
    />
  {/if}
  <OverviewTile label="Memory" value={percent(s.memory)} detail="of {bytes(s.memoryTotal)}" href="/server" />
  <OverviewTile label="Disk" value={percent(s.disk)} detail="of {bytes(s.diskTotal)}" href="/server" bad={(s.disk ?? 0) >= 90} />
  {#if backups}
    <OverviewTile
      label="Backups"
      value={unbacked.length ? `${unbacked.length} behind` : 'Up to date'}
      detail={unbacked.length ? unbacked.join(', ') : 'Every app'}
      bad={unbacked.length > 0}
    />
  {/if}
</section>

{#if data.agentError}
  <Alert variant="destructive" class="mb-6">
    <AlertTitle>Can't reach the agent</AlertTitle>
    <AlertDescription>{data.agentError}. Apps keep running; this page can't show or change them until the agent answers.</AlertDescription>
  </Alert>
{:else if data.apps.length === 0}
  <div class="border p-10 text-center">
    <p class="text-headline">No apps yet</p>
    <p class="mt-1 text-footnote text-muted-foreground">Add a Docker image and Spotcraft runs it behind HTTPS, on its own subdomain or your domain.</p>
    <Button href="/apps/new" class="mt-4">Add your first app</Button>
  </div>
{:else}
  {#if data.backups === 'unavailable'}
    <Alert variant="destructive" class="mb-4"><AlertTitle>Backup status unavailable</AlertTitle><AlertDescription>The agent couldn't say how the backups went. Check its log.</AlertDescription></Alert>
  {/if}
  <div class="border bg-card">
    <div class="hidden gap-6 border-b px-4 py-2 text-caption-1 text-muted-foreground md:flex" aria-hidden="true">
      <span class="flex-1">App</span>
      <span class="grid w-[26rem] shrink-0 grid-cols-[10rem_8rem_minmax(0,1fr)] gap-4"><span>Uptime, 24 hours</span><span>Memory</span><span class="text-right">Traffic</span></span>
    </div>
    <ul class="divide-y">
      {#each data.apps as app (app.name)}
        <AppRow {app} uptime={data.uptime[app.name]} uptimeHourly={data.uptimeHourly[app.name] ?? []} memory={data.memory[app.name]} backup={backups ? (backups[app.name] ?? null) : undefined} details={data.details} domains={data.domains} now={data.now} />
      {/each}
    </ul>
  </div>
{/if}
