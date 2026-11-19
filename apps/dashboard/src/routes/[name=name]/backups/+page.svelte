<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import { Button } from '@spotcraft/ui/components/button'
  import { backupHealth } from '#lib/backup.ts'
  import AppHeading from '#lib/components/AppHeading.svelte'
  import { ago, bytes, dateTime } from '#lib/format.ts'
  import { enhance } from '$app/forms'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()

  const app = $derived(data.app)
  let backingUp = $state(false)
</script>

<svelte:head><title>Backups · {app.name} · Spotcraft</title></svelte:head>

<AppHeading title="Backups" {app} />

{#if data.enabled}
  {@const known = form && 'backedUp' in form ? form.backedUp : data.last}
  {@const last = known === 'unavailable' ? null : known}
  {@const health = backupHealth(last)}
  <section>
    <h2 class="sr-only">Backups</h2>
    <div class="space-y-3 border bg-card p-4 text-footnote">
      <p class="text-muted-foreground">
        Every night at 03:00 UTC: {app.database ? 'a dump of its database and ' : ''}its settings, kept as long as the bucket keeps them (30 days by default).
      </p>
      {#if known === 'unavailable'}
        <p class="text-destructive">The agent couldn't say how the last backup went. Check its log.</p>
      {:else if health === 'none'}
        <p>No backup yet.</p>
      {:else if last}
        <p class={health === 'ok' ? '' : 'text-destructive'}>
          {#if last.ok}
            Last backup {ago(last.at)} ({dateTime(last.at)}){#if app.database}, database {bytes(last.bytes ?? 0)}{/if}.
            {#if health === 'overdue'}That is more than a day ago: check the agent's log.{/if}
          {:else}
            The last backup failed {ago(last.at)}: {last.error}.
            {#if last.lastOkAt}The last one that worked was {ago(last.lastOkAt)}.{:else}None has worked yet.{/if}
          {/if}
        </p>
      {/if}
      {#if form && 'backupError' in form}<p class="text-destructive">{form.backupError}</p>{/if}
      <form
        method="POST"
        action="?/backup"
        use:enhance={() => {
          backingUp = true
          return async ({ update }) => {
            await update()
            backingUp = false
          }
        }}
      >
        <Button type="submit" variant="outline" disabled={backingUp}>{backingUp ? 'Backing up…' : 'Back up now'}</Button>
      </form>
    </div>
  </section>
{:else}
  <Alert><AlertTitle>Backups are off</AlertTitle><AlertDescription>Set the backup bucket in the server's <span class="font-mono">.env</span> to turn them on.</AlertDescription></Alert>
{/if}
