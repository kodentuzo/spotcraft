<script lang="ts">
  import { capitalized, countryName, flag } from '#lib/breakdown.ts'
  import AppHeading from '#lib/components/AppHeading.svelte'
  import Breakdown from '#lib/components/Breakdown.svelte'
  import UsageChart from '#lib/components/UsageChart.svelte'
  import { count } from '#lib/format.ts'
  import { change, fillDays, lastDays, seriesDays } from '#lib/usage.ts'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  const app = $derived(data.app)
</script>

{#snippet noReferrers()}
  <p class="text-base font-semibold">No referrers yet</p>
  <p class="mt-1 text-sm text-muted-foreground">Sites that link here show up once visitors follow their links.</p>
{/snippet}

{#snippet noEvents()}
  <p class="text-base font-semibold">No custom events</p>
  <p class="mt-1 text-sm text-muted-foreground">
    Count button clicks, sign-ups and other actions: the tracker is already on every page, so the app calls
    <code class="font-mono text-xs">umami.track('signup')</code>.
  </p>
{/snippet}

{#snippet noClients()}
  <p class="text-base font-semibold">No app versions yet</p>
  <p class="mt-1 text-sm text-muted-foreground">
    Native and desktop apps show up here once they send <code class="font-mono text-xs">Spotcraft-Client: &lt;platform&gt;/&lt;version&gt;</code>.
  </p>
{/snippet}

<svelte:head><title>Usage · {app.name} · Spotcraft</title></svelte:head>

<AppHeading title="Usage" {app} />

<section>
  {#await data.usage}
    <p class="text-sm text-muted-foreground">Counting…</p>
  {:then usage}
    {@const visits = usage.visits}
    {@const accounts = usage.accounts}
    {@const requests = usage.requests}
    {@const week = lastDays(7)}
    {@const daily = visits?.perDay ?? []}
    <UsageChart
      tabs={[
        {
          label: 'Visitors',
          value: count(visits?.visitors),
          change: change(visits?.visitors, visits?.previous.visitors),
          points: fillDays(week, daily.map((d) => ({ day: d.day, value: d.visitors }))),
          format: (v) => `${count(v)} ${v === 1 ? 'visitor' : 'visitors'}`,
          note: visits ? 'Visitors per day, last 7 days (UTC); today is still counting' : app.analytics === false ? 'Analytics is off for this app' : 'Not counted yet',
        },
        {
          label: 'Page views',
          value: count(visits?.views),
          change: change(visits?.views, visits?.previous.views),
          points: fillDays(week, daily.map((d) => ({ day: d.day, value: d.views }))),
          format: (v) => `${count(v)} ${v === 1 ? 'view' : 'views'}`,
          note: visits ? `Pages and app screens per day · ${count(visits.visits)} visits in all` : 'Pages and app screens',
        },
        {
          label: 'Active accounts',
          value: count(accounts?.active.week),
          change: null,
          points: fillDays(week, (accounts?.newPerDay ?? []).map((d) => ({ day: d.day, value: d.count }))),
          format: (v) => `${count(v)} new`,
          note: accounts ? `New accounts per day · ${count(accounts.active.day)} active today, ${count(accounts.active.month)} in 30 days` : 'Accounts in the user pool that use this app',
        },
        {
          label: 'Requests',
          value: count(requests.week),
          change: change(requests.week, requests.previousWeek),
          points: requests.perDay.length ? seriesDays(requests.perDay) : fillDays(week, []),
          format: (v) => `${count(v)} ${v === 1 ? 'request' : 'requests'}`,
          note: 'Requests per day, each point the 24 hours before it',
        },
      ]}
    />
    {@const people = visits?.visitors ?? 0}
    <div class="mt-3 grid gap-3 md:grid-cols-2">
      <Breakdown
        label="Pages"
        tabs={[
          { label: 'Pages', unit: 'Views', rows: visits?.pages.map((p) => ({ name: p.path, count: p.views })) ?? [], mono: true },
          { label: 'Hostnames', unit: 'Views', rows: visits?.hostnames ?? [] },
        ]}
      />
      <Breakdown
        label="Referrers"
        tabs={[{ label: 'Referrers', unit: 'Views', rows: visits?.referrers ?? [], empty: noReferrers }]}
      />
    </div>
    <div class="mt-3 grid gap-3 md:grid-cols-3">
      <Breakdown
        label="Countries"
        tabs={[{ label: 'Countries', unit: 'Visitors', rows: visits?.countries ?? [], total: people, show: (code) => ({ text: countryName(code), before: flag(code) }) }]}
      />
      <Breakdown
        label="Devices and browsers"
        tabs={[
          { label: 'Devices', unit: 'Visitors', rows: visits?.devices ?? [], total: people, show: (name) => ({ text: capitalized(name) }) },
          { label: 'Browsers', unit: 'Visitors', rows: visits?.browsers ?? [], total: people },
        ]}
      />
      <Breakdown
        label="Operating systems"
        tabs={[{ label: 'Operating systems', unit: 'Visitors', rows: visits?.systems.map((s) => ({ name: s.name, count: s.visitors })) ?? [], total: people }]}
      />
    </div>
    <div class="mt-3 grid gap-3 md:grid-cols-2">
      <Breakdown label="Events" tabs={[{ label: 'Events', unit: 'Total', rows: visits?.events ?? [], mono: true, empty: noEvents }]} />
      <Breakdown
        label="App versions"
        tabs={[{ label: 'App versions', unit: 'Active accounts', rows: accounts?.clients.map((c) => ({ name: c.client, count: c.active })) ?? [], mono: true, empty: noClients }]}
      />
    </div>
    <p class="mt-2 text-xs text-muted-foreground">
      Counted without cookies or anything that identifies a visitor
      (<a class="underline" href="https://{app.hostnames[0]}/_spotcraft/privacy">what is counted</a>). Visitors from apps are approximate.
    </p>
  {/await}
</section>
