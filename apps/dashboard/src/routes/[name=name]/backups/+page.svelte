<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import * as AlertDialog from '@spotcraft/ui/components/alert-dialog'
  import { Button } from '@spotcraft/ui/components/button'
  import * as Card from '@spotcraft/ui/components/card'
  import { backupHealth } from '#lib/backup.ts'
  import AppHeading from '#lib/components/AppHeading.svelte'
  import { ago, bytes, dateTime } from '#lib/format.ts'
  import { enhance } from '$app/forms'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()

  const app = $derived(data.app)
  let backingUp = $state(false)
  /** The backup the confirmation dialog is about. */
  let chosen = $state<{ key: string; at: string } | undefined>()
  let confirming = $state(false)
  let restoring = $state(false)
</script>

<svelte:head><title>Backups · {app.name} · Spotcraft</title></svelte:head>

<AppHeading title="Backups" {app} />

{#if data.enabled}
  {@const known = form && 'backedUp' in form ? form.backedUp : data.last}
  {@const last = known === 'unavailable' ? null : known}
  {@const health = backupHealth(last)}
  <section>
    <h2 class="sr-only">Backups</h2>
    <Card.Root size="sm"><Card.Content class="space-y-3 text-sm">
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
    </Card.Content></Card.Root>
  </section>

  {#if app.database}
    <section class="mt-8">
      <h2 class="mb-2 text-base font-semibold">Restore</h2>
      <Card.Root size="sm"><Card.Content class="space-y-3 text-sm">
        <p class="text-muted-foreground">
          Puts the database back as it was at a backup. The data now is backed up first, then the app is deployed again, so its migrations run on the restored data. People who deleted their account since stay deleted.
        </p>
        {#if restoring}
          <p aria-live="polite">Restoring… This takes a backup, the restore and a deploy, so it can take a few minutes.</p>
        {:else if form && 'restored' in form && form.restored}
          <p>
            Restored from the backup of {form.at ? dateTime(form.at) : form.restored.restored}.
            {#if form.restored.before}The data from just before is in a new backup, at the top of the list.{/if}
          </p>
        {/if}
        {#if form && 'restoreError' in form}
          <p class="text-destructive">{form.restoreError}</p>
          <p>Its data is as it was before, and nothing was deployed.</p>
        {/if}
        {#if data.backups === 'unavailable'}
          <p class="text-destructive">The agent couldn't list the backups in the bucket. Check its log.</p>
        {:else if data.backups.length === 0}
          <p>No backup in the bucket yet.</p>
        {:else}
          <ul class="divide-y">
            {#each data.backups as backup (backup.key)}
              <li class="flex flex-row flex-wrap items-center justify-between gap-2 py-2">
                <span>{dateTime(backup.at)} <span class="text-muted-foreground">({ago(backup.at)})</span></span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={restoring}
                  onclick={() => {
                    chosen = backup
                    confirming = true
                  }}
                >Restore</Button>
              </li>
            {/each}
          </ul>
        {/if}
      </Card.Content></Card.Root>
    </section>

    <AlertDialog.Root bind:open={confirming}>
      <AlertDialog.Content>
        <AlertDialog.Header>
          <AlertDialog.Title>Restore {app.name}?</AlertDialog.Title>
          <AlertDialog.Description>
            {#if chosen}Its database goes back to {dateTime(chosen.at)}. Everything saved since is replaced.{/if}
            A backup of the data now is made first, so you can go back. The app may answer with errors for a few seconds, until it is deployed again.
          </AlertDialog.Description>
        </AlertDialog.Header>
        <form
          id="restore-backup"
          class="hidden"
          method="POST"
          action="?/restore"
          use:enhance={() => {
            restoring = true
            confirming = false
            return async ({ update }) => {
              await update()
              restoring = false
            }
          }}
        >
          <input type="hidden" name="key" value={chosen?.key ?? ''} />
          <input type="hidden" name="at" value={chosen?.at ?? ''} />
        </form>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
          <Button type="submit" form="restore-backup" variant="destructive">Restore</Button>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  {/if}
{:else}
  <Alert><AlertTitle>Backups are off</AlertTitle><AlertDescription>Set the backup bucket in the server's <span class="font-mono">.env</span> to turn them on.</AlertDescription></Alert>
{/if}
