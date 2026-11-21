<script lang="ts">
  import type { HostStatus } from '@spotcraft/agent/app-spec'
  import * as Card from '@spotcraft/ui/components/card'
  import * as Table from '@spotcraft/ui/components/table'

  let { hosts }: { hosts: HostStatus[] } = $props()

  const stateLabel = { active: 'Active', pending: 'Pending', missing: 'Missing', unknown: 'Not checked' }
  const modeLabel = { zone: 'DNS by Spotcraft', saas: 'Cloudflare custom hostname', manual: 'DNS set by hand' }
</script>

<ul class="space-y-3">
  {#each hosts as host (host.host)}
    <li><Card.Root size="sm"><Card.Content>
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
          <Table.Root class="font-mono text-xs">
            <Table.Body>
              {#each host.records as record (record.type + record.name)}
                <Table.Row>
                  <Table.Cell class="pl-0">{record.type}</Table.Cell>
                  <Table.Cell class="whitespace-normal break-all">{record.name}</Table.Cell>
                  <Table.Cell class="pr-0 whitespace-normal break-all">{record.value}</Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </div>
        {#if host.mode === 'saas' && host.host.split('.').length === 2}
          <p class="mt-2 text-xs text-muted-foreground">A root domain needs CNAME flattening (or an ALIAS record) at its DNS provider.</p>
        {/if}
      {/if}
    </Card.Content></Card.Root></li>
  {/each}
</ul>
