<script lang="ts">
  import { capitalized, countryName, flag } from '#lib/breakdown.ts'
  import Breakdown from '#lib/components/Breakdown.svelte'
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
    <p class="text-footnote text-muted-foreground">Counting…</p>
  {:then usage}
    {@const visits = usage.visits}
    {@const accounts = usage.accounts}
    {@const people = visits?.visitors ?? 0}
    <div class="grid gap-3 md:grid-cols-2">
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
