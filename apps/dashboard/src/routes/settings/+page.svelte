<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import { Button } from '@spotcraft/ui/components/button'
  import * as Card from '@spotcraft/ui/components/card'
  import { Input } from '@spotcraft/ui/components/input'
  import { Label } from '@spotcraft/ui/components/label'
  import { Textarea } from '@spotcraft/ui/components/textarea'
  import { RELEASE_URL, VERSION } from '#lib/version.ts'
  import { enhance } from '$app/forms'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()

  const s = $derived(data.settings)
  const on = (value: boolean | undefined) => (value ? 'On' : 'Off')

  /** What the form shows: what was just sent back with an error, else what is saved. */
  const owner = $derived.by(() => {
    const sent = form && 'owner' in form ? form.owner : undefined
    const saved = data.legal?.owner
    return {
      name: sent?.name ?? saved?.name ?? '',
      address: sent?.address ?? saved?.address.join('\n') ?? '',
      email: sent?.email ?? saved?.email ?? '',
      authorityName: sent?.authority.name ?? saved?.authority.name ?? '',
      authorityUrl: sent?.authority.url ?? saved?.authority.url ?? '',
      hostingName: sent?.hosting.name ?? saved?.hosting.name ?? 'Hetzner Online GmbH',
      hostingCountry: sent?.hosting.country ?? saved?.hosting.country ?? 'DE',
    }
  })
  let saving = $state(false)

  /** The processings, in the dashboard's words; apps get the full text from Spotstrap. */
  const WHAT: Record<string, string> = {
    hosting: 'Hosting: everything the apps store and serve, on the server',
    edge: "Cloudflare in front: requests and visitors' IP addresses pass through it",
    accounts: 'Accounts: guests and users, and their data in apps',
    sessions: 'Sessions: IP address and user agent, against abuse',
    backups: "Backups: nightly copies of every app's data and the accounts",
    analytics: 'Analytics: page views and events, without cookies or ids',
  }
  /** How long, in words: backups count from when they're made, the rest from last use. */
  const kept = (id: string, days: number | null) => {
    if (days) return id === 'backups' ? `Kept ${days} days.` : `Kept ${days} days after last use.`
    return id === 'analytics' ? 'No time limit set yet.' : ''
  }
  const BASIS: Record<string, string> = {
    contract: 'Art. 6(1)(b), running the service',
    'legitimate-interests': 'Art. 6(1)(f), legitimate interests',
    consent: 'Art. 6(1)(a), consent',
  }
</script>

<svelte:head><title>Settings · Spotcraft</title></svelte:head>

<h1 class="mb-1 font-heading text-2xl font-bold">Settings</h1>
<p class="mb-6 text-sm text-muted-foreground">How this instance is set up. They come from the server's <span class="font-mono">.env</span> and change with a deploy.</p>

{#if data.agentError}
  <Alert variant="destructive" class="mb-6"><AlertTitle>Can't reach the agent</AlertTitle><AlertDescription>{data.agentError}.</AlertDescription></Alert>
{/if}

<Card.Root size="sm"><Card.Content class="text-sm">
  <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-3">
    <dt class="text-muted-foreground">Version</dt>
    <dd><a href={RELEASE_URL} class="hover:underline" rel="noopener noreferrer">Spotcraft v{VERSION}</a></dd>
    {#if s}
      <dt class="text-muted-foreground">Dashboard</dt><dd class="font-mono">{s.dashboardDomain ?? '—'}</dd>
      <dt class="text-muted-foreground">Apps domain</dt>
      <dd>{#if s.appsDomain}<span class="font-mono">&lt;app&gt;.{s.appsDomain}</span>{:else}None: every app needs its own domain{/if}</dd>
      <dt class="text-muted-foreground">Edge</dt>
      <dd>{s.edge === 'cloudflare' ? 'Behind a Cloudflare Tunnel; Cloudflare holds the certificates' : 'Direct: Caddy is public and gets the certificates'}</dd>
      <dt class="text-muted-foreground">DNS</dt><dd>{s.dns ? 'Set up through the Cloudflare API' : 'Set by hand'}</dd>
      <dt class="text-muted-foreground">Cloudflare Access</dt><dd>{on(s.access)}</dd>
      <dt class="text-muted-foreground">Backups</dt><dd>{s.backups ? 'Every night, to the bucket' : 'Off'}</dd>
      <dt class="text-muted-foreground">User pool</dt><dd>{#if s.authIssuer}<span class="font-mono">{s.authIssuer}</span>{:else}Off{/if}</dd>
    {/if}
  </dl>
</Card.Content></Card.Root>

<section id="legal" class="mt-8">
  <h2 class="mb-1 text-base font-semibold">Privacy and legal</h2>
  <p class="mb-3 text-sm text-muted-foreground">
    Who runs these apps, and what this instance does with personal data. Every app gets them as <span class="font-mono">LEGAL_FACTS</span>, and serves them at <span class="font-mono">/_spotcraft/legal.json</span>, for its privacy policy and legal notice. Nothing of this goes into a repository.
  </p>
  {#if !data.legal}
    <Alert><AlertTitle>Not available</AlertTitle><AlertDescription>The agent didn't answer with the legal facts. Check its log.</AlertDescription></Alert>
  {:else}
    {@const facts = data.legal.facts}
    <Card.Root size="sm"><Card.Content class="space-y-4 text-sm">
      {#if !data.legal.owner}
        <p class="text-destructive">Your details aren't set yet, so apps can't show who runs them.</p>
      {/if}
      {#if form && 'legalSaved' in form}
        <p>
          Saved. Every app's site serves the new facts now.
          {#if form.redeploying?.length}{form.redeploying.length === 1 ? '1 app is' : `${form.redeploying.length} apps are`} being deployed again, one after the other, to get them.{/if}
        </p>
      {/if}
      {#if form && 'legalError' in form}<p class="text-destructive">{form.legalError}</p>{/if}
      <form
        method="POST"
        action="?/legal"
        class="grid gap-4 sm:grid-cols-2"
        use:enhance={() => {
          saving = true
          return async ({ update }) => {
            await update({ reset: false })
            saving = false
          }
        }}
      >
        <div class="grid gap-1.5">
          <Label for="legal-name">Name</Label>
          <Input id="legal-name" name="name" value={owner.name} required autocomplete="name" />
          <p class="text-xs text-muted-foreground">You, or your company: the controller.</p>
        </div>
        <div class="grid gap-1.5">
          <Label for="legal-email">Email for requests</Label>
          <Input id="legal-email" name="email" type="email" value={owner.email} required autocomplete="email" />
          <p class="text-xs text-muted-foreground">Where people ask about their data.</p>
        </div>
        <div class="grid gap-1.5 sm:col-span-2">
          <Label for="legal-address">Postal address</Label>
          <Textarea id="legal-address" name="address" rows={3} value={owner.address} required autocomplete="street-address" />
        </div>
        <div class="grid gap-1.5">
          <Label for="legal-authority-name">Supervisory authority</Label>
          <Input id="legal-authority-name" name="authorityName" value={owner.authorityName} required />
          <p class="text-xs text-muted-foreground">Where people can complain, in your country.</p>
        </div>
        <div class="grid gap-1.5">
          <Label for="legal-authority-url">Its website</Label>
          <Input id="legal-authority-url" name="authorityUrl" type="url" value={owner.authorityUrl} required placeholder="https://" />
        </div>
        <div class="grid gap-1.5">
          <Label for="legal-hosting-name">Hosting provider</Label>
          <Input id="legal-hosting-name" name="hostingName" value={owner.hostingName} required />
        </div>
        <div class="grid gap-1.5">
          <Label for="legal-hosting-country">Its country</Label>
          <Input id="legal-hosting-country" name="hostingCountry" value={owner.hostingCountry} required maxlength={2} class="w-20 uppercase" />
          <p class="text-xs text-muted-foreground">Two letters, such as DE.</p>
        </div>
        <div class="sm:col-span-2">
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Card.Content></Card.Root>

    <h3 class="mt-6 mb-2 text-sm font-semibold">What this instance does with personal data</h3>
    <Card.Root size="sm"><Card.Content class="text-sm">
      <ul class="divide-y">
        {#each facts.processing as p (p.id)}
          <li class="py-2">
            <p>{WHAT[p.id] ?? p.id}</p>
            <p class="text-muted-foreground">
              {BASIS[p.basis] ?? p.basis}.
              {kept(p.id, p.retentionDays)}
              {#if p.processor}By {p.processor.name}{p.processor.country ? ` (${p.processor.country})` : ''}.{/if}
              {#if p.transfer}Outside the EU: {p.transfer.country}, under the EU–US Data Privacy Framework.{/if}
            </p>
          </li>
        {/each}
      </ul>
      <p class="mt-3 text-muted-foreground">
        Last changed {facts.updated}. <a href="/settings/legal.json" class="text-foreground underline" download>Download the facts</a>: they are your record of processing.
      </p>
    </Card.Content></Card.Root>

    <h3 class="mt-6 mb-2 text-sm font-semibold">What you still do</h3>
    <Card.Root size="sm"><Card.Content class="text-sm">
      <ul class="list-disc space-y-1 pl-5">
        <li>Accept the data processing agreements: Hetzner's in its console{#if s?.edge === 'cloudflare' || s?.backups}, Cloudflare's in its dashboard{/if}.</li>
        <li>Keep the facts above as your record of processing (GDPR Art. 30), and download them again when they change.</li>
        <li>Answer requests sent to your email within a month (Art. 12). People can export and delete their account themselves in each app.</li>
        <li>Report a breach to your authority within 72 hours (Art. 33): <a href="https://spotcraft.dev/docs/guides/breach" class="underline" rel="noopener noreferrer">the guide</a>.</li>
        <li>Have a lawyer read your apps' privacy policy once.</li>
      </ul>
    </Card.Content></Card.Root>
  {/if}
</section>
