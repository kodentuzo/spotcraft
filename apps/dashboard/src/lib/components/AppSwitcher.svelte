<script lang="ts">
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down'
  import { buttonVariants } from '@spotcraft/ui/components/button'
  import * as DropdownMenu from '@spotcraft/ui/components/dropdown-menu'
  import { switchHref } from '#lib/nav.ts'
  import { statusView } from '#lib/status.ts'
  import type { LayoutData } from '../../routes/$types'

  interface Props {
    apps: LayoutData['apps']
    /** The page's path, so the switcher keeps the section. */
    path: string
    /** The app picked now; none is every app. */
    app?: string
  }

  let { apps, path, app }: Props = $props()
</script>

<!-- Which app the page is about, like Vercel's project switcher. -->
<DropdownMenu.Root>
  <DropdownMenu.Trigger class={buttonVariants({ variant: 'ghost', class: 'min-w-0 font-medium' })}>
    <span class="truncate">{app ?? 'All apps'}</span><ChevronsUpDown class="text-muted-foreground" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" class="max-h-[70dvh] w-64">
    <DropdownMenu.Item class={app ? 'text-muted-foreground' : 'font-medium'}>
      {#snippet child({ props })}<a href={switchHref(path)} {...props}>All apps</a>{/snippet}
    </DropdownMenu.Item>
    {#await apps then list}
      {#if list?.length}<DropdownMenu.Separator />{/if}
      {#each list ?? [] as item (item.name)}
        {@const view = statusView(item.state, item.health)}
        <DropdownMenu.Item class={app === item.name ? 'font-medium' : ''}>
          {#snippet child({ props })}
            <a href={switchHref(path, item.name)} aria-current={app === item.name ? 'page' : undefined} {...props}>
              <span class="size-2 shrink-0 rounded-full {view.bad ? 'bg-destructive' : 'bg-muted-foreground/70'}" aria-hidden="true"></span>
              <span class="truncate">{item.name}</span>
              {#if view.bad}<span class="ml-auto shrink-0 text-xs text-destructive">{view.label}</span>{:else}<span class="sr-only">, {view.label}</span>{/if}
            </a>
          {/snippet}
        </DropdownMenu.Item>
      {/each}
    {/await}
  </DropdownMenu.Content>
</DropdownMenu.Root>
