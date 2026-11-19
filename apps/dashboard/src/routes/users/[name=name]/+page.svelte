<script lang="ts">
  import AppHeading from '#lib/components/AppHeading.svelte'
  import Breakdown from '#lib/components/Breakdown.svelte'
  import Stat from '#lib/components/Stat.svelte'
  import UsageChart from '#lib/components/UsageChart.svelte'
  import { count } from '#lib/format.ts'
  import { fillDays, lastDays } from '#lib/usage.ts'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  const app = $derived(data.app)
</script>

<svelte:head><title>Users · {app.name} · Spotcraft</title></svelte:head>

<AppHeading title="Users" {app} />
<p class="-mt-3 mb-6 text-footnote text-muted-foreground">
  Every app shares one user pool (<a href="/users" class="underline">all users</a>). These are the accounts with a session on {app.name}'s addresses: counts only.
</p>

{#await data.accounts}
  <p class="text-footnote text-muted-foreground">Counting…</p>
{:then accounts}
  {#if accounts}
    <div class="grid gap-3 sm:grid-cols-3">
      <Stat label="Active today" value={count(accounts.active.day)} />
      <Stat label="Active in 7 days" value={count(accounts.active.week)} />
      <Stat label="Active in 30 days" value={count(accounts.active.month)} />
    </div>
    <div class="mt-3">
      <UsageChart
        tabs={[
          {
            label: 'New accounts',
            value: count(accounts.newPerDay.reduce((sum, d) => sum + d.count, 0)),
            change: null,
            points: fillDays(lastDays(30, data.now), accounts.newPerDay.map((d) => ({ day: d.day, value: d.count }))),
            format: (v) => `${count(v)} new`,
            note: 'Accounts whose first session on this app was that day (UTC), last 30 days',
            partialLast: true,
          },
        ]}
      />
    </div>
    <div class="mt-3">
      <Breakdown
        label="App versions"
        tabs={[{ label: 'App versions', unit: 'Active accounts', rows: accounts.clients.map((c) => ({ name: c.client, count: c.active })), mono: true }]}
      />
    </div>
  {:else}
    <p class="text-footnote text-muted-foreground">No accounts counted: the server has no user pool, or it didn't answer.</p>
  {/if}
{/await}
