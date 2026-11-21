<script lang="ts">
  import Archive from '@lucide/svelte/icons/archive'
  import ChartLine from '@lucide/svelte/icons/chart-line'
  import Globe from '@lucide/svelte/icons/globe'
  import LayoutGrid from '@lucide/svelte/icons/layout-grid'
  import LogOut from '@lucide/svelte/icons/log-out'
  import Logs from '@lucide/svelte/icons/logs'
  import Server from '@lucide/svelte/icons/server'
  import Settings from '@lucide/svelte/icons/settings-2'
  import Users from '@lucide/svelte/icons/users'
  import * as Avatar from '@spotcraft/ui/components/avatar'
  import * as Sidebar from '@spotcraft/ui/components/sidebar'
  import favicon from '#lib/assets/favicon.svg'
  import { hrefFor, SECTIONS, type Section } from '#lib/nav.ts'
  import { RELEASE_URL, VERSION } from '#lib/version.ts'
  import type { LayoutData } from '../../routes/$types'

  interface Props {
    data: LayoutData
    /** The section open now, and the app picked in the switcher. */
    section?: Section
    app?: string
  }

  let { data, section, app }: Props = $props()

  const icons = { overview: LayoutGrid, usage: ChartLine, logs: Logs, server: Server, domains: Globe, backups: Archive, users: Users, settings: Settings }

  const sidebar = Sidebar.useSidebar()
  // On a phone the sidebar is a sheet: close it once a link is followed.
  const close = () => sidebar.setOpenMobile(false)
</script>

<Sidebar.Root>
  <!-- The instance, where Vercel shows the team: one instance, so nothing to switch. -->
  <Sidebar.Header class="h-14 flex-row items-center gap-2 border-b border-sidebar-border px-4">
    <img src={favicon} alt="" width="24" height="24" class="size-6" />
    <a href="/" class="min-w-0 truncate text-sm font-medium" onclick={close}>
      {#await data.settings}Spotcraft{:then settings}{settings?.dashboardDomain ?? 'Spotcraft'}{/await}
    </a>
    <a href={RELEASE_URL} rel="noopener noreferrer" class="ml-auto shrink-0 border border-sidebar-border px-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground" title="Release notes">v{VERSION}</a>
  </Sidebar.Header>

  <Sidebar.Content>
    <nav aria-label="Main" class="flex flex-col gap-2">
      {#await data.settings then settings}
        {#each SECTIONS as group, i (i)}
          <Sidebar.Group class={i > 0 ? 'pt-0' : ''}>
            <Sidebar.Menu>
              {#each group as item (item.id)}
                {#if item.id !== 'backups' || settings?.backups}
                  {@const Icon = icons[item.id]}
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton isActive={section === item.id}>
                      {#snippet child({ props })}
                        <!-- Links keep the app picked in the switcher. -->
                        <a href={hrefFor(item.id, app)} onclick={close} aria-current={section === item.id ? 'page' : undefined} {...props}>
                          <Icon /><span>{item.label}</span>
                        </a>
                      {/snippet}
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                {/if}
              {/each}
            </Sidebar.Menu>
          </Sidebar.Group>
        {/each}
      {/await}
    </nav>
  </Sidebar.Content>

  <Sidebar.Footer class="border-t border-sidebar-border">
    <!-- Who is signed in: the Access email and its Gravatar, or the password. -->
    <div class="flex items-center gap-3 px-2 py-1" title={data.accessEmail ?? 'Signed in with the dashboard password'}>
      <Avatar.Root class="size-7">
        {#if data.avatar}<Avatar.Image src={data.avatar} alt="" referrerpolicy="no-referrer" />{/if}
        <Avatar.Fallback class="text-xs uppercase">{(data.accessEmail ?? 'Admin').charAt(0)}</Avatar.Fallback>
      </Avatar.Root>
      <span class="min-w-0">
        <span class="block truncate text-sm">{data.accessEmail ?? 'Admin'}</span>
        {#if !data.accessEmail}<span class="block text-xs text-muted-foreground">Signed in with the password</span>{/if}
      </span>
    </div>
    <form method="POST" action="/logout">
      <Sidebar.Menu>
        <Sidebar.MenuItem>
          <Sidebar.MenuButton class="text-muted-foreground">
            {#snippet child({ props })}
              <button type="submit" {...props}><LogOut /><span>Log out</span></button>
            {/snippet}
          </Sidebar.MenuButton>
        </Sidebar.MenuItem>
      </Sidebar.Menu>
    </form>
  </Sidebar.Footer>
</Sidebar.Root>
