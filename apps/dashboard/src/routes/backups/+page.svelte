<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import { Button } from '@spotcraft/ui/components/button'
  import { backupHealth } from '#lib/backup.ts'
  import AppTile from '#lib/components/AppTile.svelte'
  import { ago, bytes, dateTime } from '#lib/format.ts'
  import { enhance } from '$app/forms'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()

  let running = $state<string | null>(null)
  const label = { ok: 'Backed up', failed: 'Failed', overdue: 'Overdue', none: 'None yet' }
</script>

<svelte:head><title>Backups · Spotcraft</title></svelte:head>

<h1 class="mb-1 font-heading text-2xl font-bold">Backups</h1>
<p class="mb-6 text-sm text-muted-foreground">
  Every night at 03:00 UTC: each app's settings and a dump of its database, kept as long as the bucket keeps them (30 days by default).
</p>

{#if data.agentError}
  <Alert variant="destructive"><AlertTitle>Can't reach the agent</AlertTitle><AlertDescription>{data.agentError}.</AlertDescription></Alert>
{:else if !data.enabled}
  <Alert><AlertTitle>Backups are off</AlertTitle><AlertDescription>Set the backup bucket in the server's <span class="font-mono">.env</span> to turn them on.</AlertDescription></Alert>
{:else}
  <ul class="divide-y border bg-card">
    {#each data.apps as app (app.name)}
      {@const last = form?.name === app.name && form && 'backedUp' in form ? form.backedUp : (data.last[app.name] ?? null)}
      {@const health = backupHealth(last)}
      <li class="flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-6">
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <AppTile name={app.name} host={app.host} />
          <div class="min-w-0">
            <a href="/{app.name}/backups" class="text-base font-semibold hover:underline">{app.name}</a>
            <p class="text-xs {health === 'ok' ? 'text-muted-foreground' : 'text-destructive'}">
              {label[health]}{#if last?.ok}{` · ${ago(last.at)} · ${dateTime(last.at)}`}{#if app.database}{` · ${bytes(last.bytes ?? 0)}`}{/if}{:else if last}{` · ${ago(last.at)}: ${last.error}`}{/if}
            </p>
            {#if last && !last.ok && last.lastOkAt}<p class="text-xs text-muted-foreground">Last one that worked: {ago(last.lastOkAt)}</p>{/if}
            {#if form?.name === app.name && form && 'backupError' in form}<p class="text-xs text-destructive">{form.backupError}</p>{/if}
          </div>
        </div>
        <form
          method="POST"
          action="?/backup"
          use:enhance={() => {
            running = app.name
            return async ({ update }) => {
              await update({ reset: false })
              running = null
            }
          }}
        >
          <input type="hidden" name="name" value={app.name} />
          <Button type="submit" variant="outline" disabled={running !== null}>{running === app.name ? 'Backing up…' : 'Back up now'}</Button>
        </form>
      </li>
    {/each}
  </ul>
{/if}
