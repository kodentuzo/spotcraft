<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '@spotcraft/ui/components/alert'
  import * as AlertDialog from '@spotcraft/ui/components/alert-dialog'
  import { Button, buttonVariants } from '@spotcraft/ui/components/button'
  import { Input } from '@spotcraft/ui/components/input'
  import { Label } from '@spotcraft/ui/components/label'
  import { backupHealth } from '#lib/backup.ts'
  import { ago, bytes, dateTime } from '#lib/format.ts'
  import { enhance } from '$app/forms'
  import type { ActionData, PageData } from './$types'

  let { data, form }: { data: PageData; form: ActionData } = $props()

  const app = $derived(data.app)
  const stateLabel = { active: 'Active', pending: 'Pending', missing: 'Missing', unknown: 'Not checked' }
  const modeLabel = { zone: 'DNS by Spotcraft', saas: 'Cloudflare custom hostname', manual: 'DNS set by hand' }
  let purge = $state(false)
  let backingUp = $state(false)
  let moving = $state(false)

  // A GitHub Actions step for the app's workflow, after its image is pushed (ADR 0029).
  const hookStep = $derived(`- name: Deploy to Spotcraft
  timeout-minutes: 20
  env:
    URL: ${data.hook.url}
    TOKEN: \${{ secrets.SPOTCRAFT_DEPLOY_TOKEN }}
    # A pull may take 5 minutes and the health check 2, after other apps' deploys.
    WAIT_MINUTES: 15
  run: |
    TAG="sha-\${GITHUB_SHA::7}"
    auth="Authorization: Bearer $TOKEN"
    curl -fsS --retry 5 --retry-all-errors -X POST "$URL" -H "$auth" \\
      -H 'content-type: application/json' -d "{\\"tag\\":\\"$TAG\\"}"
    deadline=$((SECONDS + WAIT_MINUTES * 60))
    while [ "$SECONDS" -lt "$deadline" ]; do
      sleep 5
      # A failed poll (Spotcraft restarting, a network blip) is tried again.
      result=$(curl -fsS "$URL" -H "$auth") || continue
      case $(echo "$result" | jq -r '.state + " " + .tag') in
        "live $TAG") exit 0 ;;
        live*) echo "Another tag is live: $result"; exit 1 ;;
        failed*) echo "$result"; exit 1 ;;
      esac
    done
    echo "Not live after $WAIT_MINUTES minutes"; exit 1`)
</script>

<section id="settings">
  <h2 class="mb-2 text-headline">Settings</h2>
  <div class="border bg-card p-4 text-footnote">
    <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2">
      <dt class="text-muted-foreground">Image</dt><dd class="truncate font-mono">{app.image}:{app.tag}</dd>
      <dt class="text-muted-foreground">Limits</dt><dd>{app.memory} memory · {app.cpus} CPU</dd>
      <dt class="text-muted-foreground">Port</dt><dd class="tabular-nums">{app.port}</dd>
      <dt class="text-muted-foreground">Filesystem</dt><dd>{app.readOnly ? 'Read-only' : 'Writable'}</dd>
      <dt class="text-muted-foreground">Database</dt>
      <dd>
        {#if app.database}Postgres <span class="font-mono">app_{app.name.replaceAll('-', '_')}</span>{:else}None{/if}
      </dd>
      <dt class="text-muted-foreground">Sign-in</dt><dd>{app.protected ? 'Cloudflare Access' : 'Public'}</dd>
      <dt class="text-muted-foreground">Analytics</dt><dd>{app.analytics === false ? 'Off' : 'On'}</dd>
      <dt class="text-muted-foreground">Environment</dt><dd>{Object.keys(app.env).length === 1 ? '1 variable' : `${Object.keys(app.env).length} variables`}</dd>
    </dl>
  </div>
</section>

{#await data.domain then domain}
{#if domain && domain.hosts.length > 0}
  <section id="domain" class="mt-8">
    <h2 class="mb-2 text-headline">Domain</h2>
    <ul class="space-y-3">
      {#each domain.hosts as host (host.host)}
        <li class="border bg-card p-4 text-footnote">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-mono">{host.host}</span>
            <span class={['text-xs', host.state === 'active' ? 'text-muted-foreground' : 'text-destructive']}>
              {stateLabel[host.state]} · {modeLabel[host.mode]}
            </span>
          </div>
          {#if host.detail}<p class="mt-1 text-xs text-muted-foreground">{host.detail}</p>{/if}
          {#if host.state !== 'active' && host.records.length > 0}
            <p class="mt-3 text-xs text-muted-foreground">Add these records where the domain's DNS is hosted:</p>
            <div class="mt-1 overflow-x-auto">
              <table class="w-full text-left font-mono text-xs">
                <tbody>
                  {#each host.records as record (record.type + record.name)}
                    <tr>
                      <td class="py-1 pr-4">{record.type}</td>
                      <td class="py-1 pr-4 break-all">{record.name}</td>
                      <td class="py-1 break-all">{record.value}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            {#if host.mode === 'saas' && host.host.split('.').length === 2}
              <p class="mt-2 text-xs text-muted-foreground">A root domain needs CNAME flattening (or an ALIAS record) at its DNS provider.</p>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}
{/await}

{#if data.hook.enabled !== undefined}
  {@const token = form && 'hookToken' in form ? form.hookToken : undefined}
  {@const enabled = token ? true : form && 'hookDeleted' in form ? false : data.hook.enabled}
  <section id="hook" class="mt-8">
    <h2 class="mb-2 text-headline">Deploy hook</h2>
    <div class="space-y-3 border bg-card p-4 text-footnote">
      <p class="text-muted-foreground">
        Lets the app's CI deploy a new image tag, with no sign-in. Only the tag changes: the image, environment and limits stay as set here.
        {enabled ? 'On.' : 'Off.'}
      </p>
      {#if token}
        <Alert>
          <AlertTitle>Your new token, shown only once</AlertTitle>
          <AlertDescription>
            <p>Save it as the secret <span class="font-mono">SPOTCRAFT_DEPLOY_TOKEN</span> in the app's repository. Any older token no longer works.</p>
            <pre class="mt-2 overflow-x-auto border bg-muted p-2 font-mono text-xs select-all">{token}</pre>
          </AlertDescription>
        </Alert>
      {/if}
      <div class="flex flex-wrap gap-2">
        <form method="POST" action="?tab=settings&/createHook" use:enhance>
          <Button type="submit" variant="outline">{enabled ? 'New token' : 'Turn on'}</Button>
        </form>
        {#if enabled}
          <form method="POST" action="?tab=settings&/deleteHook" use:enhance>
            <Button type="submit" variant="outline">Turn off</Button>
          </form>
        {/if}
      </div>
      {#if enabled}
        <p class="text-muted-foreground">A step for the app's GitHub Actions workflow, after it pushes the image. It deploys the commit's <span class="font-mono">sha-…</span> tag and waits until it is live:</p>
        <pre class="overflow-x-auto border bg-muted p-3 text-xs leading-relaxed">{hookStep}</pre>
      {/if}
    </div>
  </section>
{/if}

{#if data.backup}
  {@const known = form && 'backedUp' in form ? form.backedUp : data.backup.last}
  {@const last = known === 'unavailable' ? null : known}
  {@const health = backupHealth(last)}
  <section id="backups" class="mt-8">
    <h2 class="mb-2 text-headline">Backups</h2>
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
        action="?tab=settings&/backup"
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
{/if}

{#if data.ownDatabase || (form && 'moved' in form)}
  <section id="database" class="mt-8">
    <h2 class="mb-2 text-headline">Own database</h2>
    <div class="space-y-3 border bg-card p-4 text-footnote">
      {#if form && 'moved' in form && form.moved}
        {@const tables = Object.entries(form.moved.tables)}
        <p>
          Moved: {form.moved.users} guests and {form.moved.sessions} sessions into the user pool{#if tables.length}, and {tables.map(([table, rows]) => `${rows} rows of ${table}`).join(', ')}{/if}.
          The old database stays, unused: drop it once you're sure.
        </p>
      {:else}
        <p class="text-muted-foreground">
          This app was made before apps shared the instance database, and keeps its guests itself. Moving it deploys a new version made for its schema and the user pool, then copies its guests, their sessions and its rows over. Guests keep their cookies. A backup comes first; if anything fails, the current version keeps running as it is.
        </p>
        {#if form && 'moveError' in form}<p class="text-destructive">{form.moveError}</p>{/if}
        <form
          method="POST"
          action="?tab=settings&/move"
          class="flex flex-wrap items-end gap-2"
          use:enhance={() => {
            moving = true
            return async ({ update }) => {
              await update({ reset: false })
              moving = false
            }
          }}
        >
          <div class="grid gap-1">
            <Label for="move-tag">New version's tag</Label>
            <Input id="move-tag" name="tag" required class="w-56 font-mono" placeholder={app.tag} value={form && 'tag' in form ? form.tag : ''} />
          </div>
          <Button type="submit" variant="outline" disabled={moving}>{moving ? 'Moving…' : 'Move'}</Button>
        </form>
      {/if}
    </div>
  </section>
{/if}

<section id="danger" class="mt-8">
  <h2 class="mb-2 text-headline">Remove</h2>
  <div class="flex flex-wrap items-center justify-between gap-4 border border-destructive/50 bg-card p-4 text-footnote">
    <p class="text-muted-foreground">Stops the app and removes its settings and its site. The image stays on Docker Hub{app.database ? '; its database is kept unless you choose otherwise' : ''}.</p>
<AlertDialog.Root>
      <AlertDialog.Trigger class={buttonVariants({ variant: 'destructive' })}>Remove</AlertDialog.Trigger>
      <AlertDialog.Content>
        <AlertDialog.Header>
          <AlertDialog.Title>Remove {app.name}?</AlertDialog.Title>
          <AlertDialog.Description>
            Stops the container and removes its settings and its site. {app.hostnames.join(' and ')} stop answering. The image stays on Docker Hub, so you can add it again.
            {#if app.database}
              Its database is kept, so adding the app again brings its data back, unless you delete it below.
            {/if}
          </AlertDialog.Description>
        </AlertDialog.Header>
        <form id="remove-app" method="POST" action="?/remove">
          {#if app.database}
            <label class="flex items-start gap-3 text-sm">
              <input type="checkbox" name="purge" bind:checked={purge} class="mt-1 size-4 accent-destructive" />
              <span>
                Also delete its database
                <span class="block text-xs text-muted-foreground">Every row in app_{app.name.replaceAll('-', '_')} is lost. This cannot be undone.</span>
              </span>
            </label>
          {/if}
        </form>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
          <Button type="submit" form="remove-app" variant="destructive">
            {purge ? `Remove ${app.name} and its data` : `Remove ${app.name}`}
          </Button>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  </div>
</section>
