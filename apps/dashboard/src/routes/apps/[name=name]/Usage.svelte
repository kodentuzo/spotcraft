<script lang="ts">
  import { capitalized, countryName, flag } from '#lib/breakdown.ts'
  import Breakdown from '#lib/components/Breakdown.svelte'
  import Sparkline from '#lib/components/Sparkline.svelte'
  import Stat from '#lib/components/Stat.svelte'
  import { count, milliseconds, percent } from '#lib/format.ts'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  const app = $derived(data.app)
</script>

{#snippet noReferrers()}
  <p class="text-headline">No referrers yet</p>
  <p class="mt-1 text-footnote text-muted-foreground">Sites that link here show up once visitors follow their links.</p>
{/snippet}

{#snippet noEvents()}
  <p class="text-headline">No custom events</p>
  <p class="mt-1 text-footnote text-muted-foreground">
    Count button clicks, sign-ups and other actions: the tracker is already on every page, so the app calls
    <code class="font-mono text-caption-1">umami.track('signup')</code>.
  </p>
{/snippet}

{#snippet noClients()}
  <p class="text-headline">No app versions yet</p>
  <p class="mt-1 text-footnote text-muted-foreground">
    Native and desktop apps show up here once they send <code class="font-mono text-caption-1">Spotcraft-Client: &lt;platform&gt;/&lt;version&gt;</code>.
  </p>
{/snippet}

<section>
  <h2 class="sr-only">Usage</h2>
  {#await data.usage}
    <p class="text-sm text-muted-foreground">Counting…</p>
  {:then usage}
    {@const visits = usage.visits}
    {@const accounts = usage.accounts}
    {@const requests = usage.requests}
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Visitors"
        value={count(visits?.visitors)}
        detail={visits ? `Last ${visits.days} days · ${count(visits.previous.visitors)} the ${visits.days} before` : app.analytics === false ? 'Analytics is off for this app' : 'Not counted yet'}
      />
      <Stat
        label="Page views"
        value={count(visits?.views)}
        detail={visits ? `${count(visits.visits)} visits · ${count(visits.previous.views)} views the ${visits.days} days before` : 'Pages and app screens'}
      />
      <Stat
        label="Active accounts"
        value={count(accounts?.active.week)}
        detail={accounts ? `Last 7 days · ${count(accounts.active.day)} today · ${count(accounts.active.month)} in 30 days` : 'Accounts in the user pool that use this app'}
      >
        {#if accounts && accounts.newPerDay.length > 1}
          <Sparkline
            series={accounts.newPerDay.map(({ day, count: n }) => [Date.parse(day) / 1000, n] as [number, number])}
            format={(v) => `${count(v)} new`}
            label="New accounts per day, last 30 days"
          />
        {/if}
      </Stat>
      <Stat
        label="Requests"
        value={count(requests.day)}
        detail={requests.day === null ? 'Last 24 hours' : `Last 24 hours · ${percent(requests.day > 0 ? ((requests.errors ?? 0) / requests.day) * 100 : 0, 1)} errors · p95 ${milliseconds(requests.p95)}`}
      >
        <Sparkline series={requests.perHour} format={(v) => `${count(v)} an hour`} label="Requests per hour, last 24 hours" />
      </Stat>
    </div>
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
