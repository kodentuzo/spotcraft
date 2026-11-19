<script lang="ts">
  import { Alert, AlertTitle } from '@spotcraft/ui/components/alert'
  import * as AlertDialog from '@spotcraft/ui/components/alert-dialog'
  import { Badge } from '@spotcraft/ui/components/badge'
  import { Button, buttonVariants } from '@spotcraft/ui/components/button'
  import * as Table from '@spotcraft/ui/components/table'
  import { ago, dateTime } from '#lib/format.ts'
  import { enhance } from '$app/forms'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()

  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  /** The user the delete dialog is about; the dialog is open while one is set. */
  let deleting = $state<string | null>(null)
</script>

<svelte:head><title>Users · Spotcraft</title></svelte:head>

<div class="mb-6">
  <h1 class="font-heading text-2xl font-bold">Users</h1>
  {#if data.page?.available}
    <p class="mt-1 text-sm text-muted-foreground">
      {count(data.page.total, 'user', 'users')}, {count(data.page.guests, 'guest', 'guests')}, shared by every app on this server, newest first. Guests are
      visitors who haven't signed up.
    </p>
  {/if}
</div>

{#if form && 'deleteError' in form}
  <Alert variant="destructive" class="mb-6"><AlertTitle>{form.deleteError}</AlertTitle></Alert>
{:else if form && 'deleted' in form}
  <Alert class="mb-6"><AlertTitle>Deleted the user and what every app kept for them.</AlertTitle></Alert>
{/if}

{#if !data.page}
  <div class="border p-10 text-center text-sm text-muted-foreground">
    This server has no Postgres, so it has no user pool.
  </div>
{:else if !data.page.available}
  <div class="border p-10 text-center text-sm text-muted-foreground">
    The user pool isn't set up yet. It appears once the auth service has started.
  </div>
{:else if data.page.users.length === 0}
  <div class="border p-10 text-center text-sm text-muted-foreground">
    No users yet. Apps add guests through <span class="font-mono">/_spotcraft/auth</span>.
  </div>
{:else}
  <div class="overflow-x-auto border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>User</Table.Head>
          <Table.Head>Kind</Table.Head>
          <Table.Head class="hidden sm:table-cell">Created</Table.Head>
          <Table.Head>Last seen</Table.Head>
          <Table.Head><span class="sr-only">Actions</span></Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each data.page.users as user (user.id)}
          <Table.Row>
            <Table.Cell class="font-mono text-xs" title={user.id}>{user.id.slice(0, 8)}…</Table.Cell>
            <Table.Cell>
              <Badge variant={user.guest ? 'secondary' : 'default'}>{user.guest ? 'Guest' : 'Registered'}</Badge>
            </Table.Cell>
            <Table.Cell class="hidden text-sm sm:table-cell">{dateTime(user.createdAt)}</Table.Cell>
            <Table.Cell class="text-sm" title={user.lastSeen ? dateTime(user.lastSeen) : 'No active session'}>{ago(user.lastSeen)}</Table.Cell>
            <Table.Cell class="text-right">
              <Button variant="ghost" size="sm" onclick={() => (deleting = user.id)}>Delete</Button>
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>

  <div class="mt-4 flex gap-2">
    {#if data.cursor}<Button href="/users" variant="outline">Newest</Button>{/if}
    {#if data.page.next}<Button href="/users?cursor={data.page.next}" variant="outline">Older</Button>{/if}
  </div>
{/if}

<AlertDialog.Root open={deleting !== null} onOpenChange={(open) => {
    if (!open) deleting = null
  }}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete this user?</AlertDialog.Title>
      <AlertDialog.Description>
        <span class="font-mono text-xs">{deleting}</span><br />
        Their sessions end and everything every app kept for them is deleted with them. This cannot be undone.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <form
      id="delete-user"
      method="POST"
      action="?/delete"
      use:enhance={() => async ({ update }) => {
        deleting = null
        await update()
      }}
    >
      <input type="hidden" name="id" value={deleting ?? ''} />
    </form>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <button type="submit" form="delete-user" class={buttonVariants({ variant: 'destructive' })}>Delete user</button>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
