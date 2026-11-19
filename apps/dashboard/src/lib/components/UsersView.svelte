<script lang="ts">
  import type { AccountUsage, UserPage } from '@spotcraft/agent/apps'
  import { Alert, AlertTitle } from '@spotcraft/ui/components/alert'
  import * as AlertDialog from '@spotcraft/ui/components/alert-dialog'
  import { Badge } from '@spotcraft/ui/components/badge'
  import { Button, buttonVariants } from '@spotcraft/ui/components/button'
  import Breakdown from '#lib/components/Breakdown.svelte'
  import Stat from '#lib/components/Stat.svelte'
  import UsageChart from '#lib/components/UsageChart.svelte'
  import { ago, count, dateTime } from '#lib/format.ts'
  import { fillDays, lastDays } from '#lib/usage.ts'
  import { enhance } from '$app/forms'

  interface Props {
    page: UserPage | null
    listError: string | null
    accounts: Promise<AccountUsage | null>
    cursor: string | null
    /** When the page was made (ms), for the chart's days. */
    now: number
    form: { deleteError?: string; deleted?: string } | null
    /** One app's users (those with a session on it), or the whole pool. */
    app?: string
  }

  let { page, listError, accounts, cursor, now, form, app }: Props = $props()

  /** The user the delete dialog is about; the dialog is open while one is set. */
  let deleting = $state<string | null>(null)
  const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`
</script>

{#if form?.deleteError}
  <Alert variant="destructive" class="mb-4"><AlertTitle>{form.deleteError}</AlertTitle></Alert>
{:else if form?.deleted}
  <Alert class="mb-4"><AlertTitle>Deleted the user and what every app kept for them.</AlertTitle></Alert>
{/if}

<!-- The counts, the same for the pool and for one app: users, then accounts active lately. -->
<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
  <Stat
    label="Users"
    value={page?.available ? count(page.total) : '—'}
    detail={page?.available ? `${plural(page.guests, 'guest', 'guests')} · ${plural(page.total - page.guests, 'registered', 'registered')}` : app ? 'With a session on this app' : 'In the user pool'}
  />
  {#await accounts}
    <Stat label="Active today" value="…" />
    <Stat label="Active in 7 days" value="…" />
    <Stat label="Active in 30 days" value="…" />
  {:then counted}
    <Stat label="Active today" value={count(counted?.active.day)} />
    <Stat label="Active in 7 days" value={count(counted?.active.week)} />
    <Stat label="Active in 30 days" value={count(counted?.active.month)} />
  {/await}
</div>

{#await accounts then counted}
  <div class="mt-3">
    <UsageChart
      tabs={[
        {
          label: 'New accounts',
          value: count((counted?.newPerDay ?? []).reduce((sum, d) => sum + d.count, 0)),
          change: null,
          points: fillDays(lastDays(30, now), (counted?.newPerDay ?? []).map((d) => ({ day: d.day, value: d.count }))),
          format: (v) => `${count(v)} new`,
          note: app
            ? 'Accounts whose first session on this app was that day (UTC), last 30 days'
            : 'Accounts whose first session was that day (UTC), last 30 days',
          partialLast: true,
        },
      ]}
    />
  </div>
  <div class="mt-3">
    <Breakdown
      label="App versions"
      tabs={[{ label: 'App versions', unit: 'Active accounts', rows: (counted?.clients ?? []).map((c) => ({ name: c.client, count: c.active })), mono: true }]}
    />
  </div>
{/await}

<section aria-labelledby="user-list" class="mt-3">
  <h2 id="user-list" class="sr-only">Users</h2>
  {#if listError}
    <Alert variant="destructive"><AlertTitle>{listError}</AlertTitle></Alert>
  {:else if !page}
    <div class="border bg-card p-10 text-center text-footnote text-muted-foreground">This server has no Postgres, so it has no user pool.</div>
  {:else if !page.available}
    <div class="border bg-card p-10 text-center text-footnote text-muted-foreground">The user pool isn't set up yet. It appears once the auth service has started.</div>
  {:else if page.users.length === 0}
    <div class="border bg-card p-10 text-center text-footnote text-muted-foreground">
      {#if app}No one has used this app yet.{:else}No users yet. Apps add guests through <span class="font-mono">/_spotcraft/auth</span>.{/if}
    </div>
  {:else}
    <div class="border bg-card">
      <div class="hidden gap-6 border-b px-4 py-2 text-caption-1 text-muted-foreground md:flex" aria-hidden="true">
        <span class="flex-1">User</span>
        <span class="w-28 shrink-0">Kind</span>
        <span class="w-44 shrink-0">Created</span>
        <span class="w-32 shrink-0">{app ? 'Last seen here' : 'Last seen'}</span>
        <span class="w-20 shrink-0"></span>
      </div>
      <ul class="divide-y">
        {#each page.users as user (user.id)}
          <li class="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-footnote">
            <span class="min-w-0 flex-1 truncate font-mono text-caption-1" title={user.id}>{user.id.slice(0, 8)}…</span>
            <span class="w-28 shrink-0"><Badge variant={user.guest ? 'secondary' : 'default'}>{user.guest ? 'Guest' : 'Registered'}</Badge></span>
            <span class="hidden w-44 shrink-0 text-muted-foreground md:inline">{dateTime(user.createdAt)}</span>
            <span class="w-32 shrink-0 text-muted-foreground" title={user.lastSeen ? dateTime(user.lastSeen) : 'No active session'}>{ago(user.lastSeen)}</span>
            <span class="w-20 shrink-0 text-right">
              <Button variant="ghost" size="sm" onclick={() => (deleting = user.id)}>Delete</Button>
            </span>
          </li>
        {/each}
      </ul>
    </div>
    <div class="mt-3 flex gap-2">
      {#if cursor}<Button href="?" variant="outline">Newest</Button>{/if}
      {#if page.next}<Button href="?cursor={page.next}" variant="outline">Older</Button>{/if}
    </div>
  {/if}
</section>

<AlertDialog.Root open={deleting !== null} onOpenChange={(open) => {
    if (!open) deleting = null
  }}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete this user?</AlertDialog.Title>
      <AlertDialog.Description>
        <span class="font-mono text-xs">{deleting}</span><br />
        Every app shares one user pool: the user goes from all of them, their sessions end and everything every app kept for them is deleted. This cannot be undone.
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
