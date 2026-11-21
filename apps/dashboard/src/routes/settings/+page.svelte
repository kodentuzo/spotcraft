<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import * as Card from '@spotcraft/ui/components/card'
  import { RELEASE_URL, VERSION } from '#lib/version.ts'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  const s = $derived(data.settings)
  const on = (value: boolean | undefined) => (value ? 'On' : 'Off')
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
