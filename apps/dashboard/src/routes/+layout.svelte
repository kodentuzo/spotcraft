<script lang="ts">
  import './layout.css'
  import favicon from '#lib/assets/favicon.svg'
  import Icon from '#lib/components/Icon.svelte'
  import { hrefFor, SECTIONS, scopeOf, switchHref, titleFor } from '#lib/nav.ts'
  import { statusView } from '#lib/status.ts'
  import { RELEASE_URL, VERSION } from '#lib/version.ts'
  import { page } from '$app/state'
  import type { LayoutProps } from './$types'

  let { data, children }: LayoutProps = $props()

  const path = $derived(page.url.pathname)
  const scope = $derived(scopeOf(path))
  const app = $derived(scope.app)
  const title = $derived(titleFor(path))

  let drawer = $state<HTMLElement>()
  let switcher = $state<HTMLElement>()
  let switcherButton = $state<HTMLElement>()
  let switcherAt = $state({ top: 0, left: 0 })

  // The switcher opens under its button; popovers otherwise sit in the middle of the screen.
  function placeSwitcher(event: ToggleEvent) {
    if (event.newState !== 'open' || !switcherButton) return
    const box = switcherButton.getBoundingClientRect()
    switcherAt = { top: box.bottom + 4, left: box.left }
  }
  const closeAll = () => {
    drawer?.hidePopover()
    switcher?.hidePopover()
  }
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{#snippet sidebar()}
  <!-- The instance, where Vercel shows the team: one instance, so nothing to switch. -->
  <div class="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
    <img src={favicon} alt="" width="24" height="24" class="size-6" />
    <a href="/" class="min-w-0 truncate text-footnote font-medium" onclick={closeAll}>
      {#await data.settings}Spotcraft{:then settings}{settings?.dashboardDomain ?? 'Spotcraft'}{/await}
    </a>
    <a href={RELEASE_URL} rel="noopener noreferrer" class="ml-auto shrink-0 border border-sidebar-border px-1.5 text-caption-1 text-muted-foreground hover:text-sidebar-foreground" title="Release notes">v{VERSION}</a>
  </div>

  <nav aria-label="Main" class="min-h-0 flex-1 overflow-y-auto p-2">
    {#await data.settings then settings}
      {#each SECTIONS as group, i (i)}
        {#if i > 0}<hr class="my-2 border-sidebar-border" />{/if}
        <ul class="space-y-0.5">
          {#each group as item (item.id)}
            {#if item.id !== 'backups' || settings?.backups}
              {@const current = scope.section === item.id}
              <li>
                <!-- Links keep the app picked in the switcher. -->
                <a
                  href={hrefFor(item.id, app)}
                  onclick={closeAll}
                  aria-current={current ? 'page' : undefined}
                  class="flex min-h-9 items-center gap-3 px-2.5 text-footnote {current ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'}"
                ><Icon name={item.icon} class="size-4" />{item.label}</a>
              </li>
            {/if}
          {/each}
        </ul>
      {/each}
    {/await}
  </nav>

  <form method="POST" action="/logout" class="border-t border-sidebar-border p-2">
    <button type="submit" class="flex min-h-9 w-full items-center gap-3 px-2.5 text-footnote text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground">
      <Icon name="logout" class="size-4" />Log out
    </button>
  </form>
  {#if data.accessEmail}<p class="truncate px-4 pb-3 text-caption-1 text-muted-foreground" title={data.accessEmail}>{data.accessEmail}</p>{/if}
{/snippet}

{#if data.authed}
  <div class="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
    <aside class="sticky top-0 hidden h-dvh flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      {@render sidebar()}
    </aside>

    <div class="min-w-0">
      <header class="sticky top-0 z-20 grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
        <div class="flex min-w-0 items-center gap-1">
          <button type="button" popovertarget="drawer" class="-ml-2 flex size-11 items-center justify-center md:hidden" aria-label="Menu">
            <Icon name="menu" />
          </button>
          <!-- Which app the page is about, like Vercel's project switcher. -->
          <button
            type="button"
            bind:this={switcherButton}
            popovertarget="switcher"
            class="flex min-h-11 min-w-0 items-center gap-2 px-2 text-footnote font-medium hover:bg-raised"
          >
            <span class="truncate">{app ?? 'All apps'}</span><Icon name="updown" class="size-4 shrink-0 text-muted-foreground" />
          </button>
        </div>
        <p class="hidden text-footnote font-medium sm:block">{title}</p>
        <div class="col-start-3 flex justify-end">
          <a href="/new" class="flex min-h-11 items-center gap-2 px-2 text-footnote hover:bg-raised" aria-label="Add app">
            <Icon name="plus" class="size-4" /><span class="hidden sm:inline">Add app</span>
          </a>
        </div>
      </header>

      <main class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        {@render children()}
      </main>
    </div>
  </div>

  <div
    id="switcher"
    popover
    bind:this={switcher}
    ontoggle={placeSwitcher}
    class="fixed m-0 max-h-[70dvh] w-64 overflow-y-auto border bg-card p-1 text-card-foreground shadow-lg"
    style="top: {switcherAt.top}px; left: {switcherAt.left}px"
  >
    <a
      href={switchHref(path)}
      onclick={closeAll}
      class="flex min-h-9 items-center px-2.5 text-footnote {app ? 'text-muted-foreground hover:bg-raised' : 'bg-raised font-medium'}"
    >All apps</a>
    {#await data.apps then apps}
      {#if apps?.length}<hr class="my-1" />{/if}
      {#each apps ?? [] as item (item.name)}
        {@const view = statusView(item.state, item.health)}
        <a
          href={switchHref(path, item.name)}
          onclick={closeAll}
          aria-current={app === item.name ? 'page' : undefined}
          class="flex min-h-9 items-center gap-3 px-2.5 text-footnote {app === item.name ? 'bg-raised font-medium' : 'hover:bg-raised'}"
        >
          <span class="size-2 shrink-0 rounded-full {view.bad ? 'bg-destructive' : 'bg-muted-foreground/70'}" aria-hidden="true"></span>
          <span class="truncate">{item.name}</span>
          {#if view.bad}<span class="ml-auto shrink-0 text-caption-1 text-destructive">{view.label}</span>{:else}<span class="sr-only">, {view.label}</span>{/if}
        </a>
      {/each}
    {/await}
  </div>

  <!-- Phones: the same sidebar, as a drawer from the menu button. -->
  <div
    id="drawer"
    popover
    bind:this={drawer}
    class="fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground backdrop:bg-black/50 open:flex"
  >
    {@render sidebar()}
  </div>
{:else}
  <main class="mx-auto max-w-5xl px-4 py-8">
    {@render children()}
  </main>
{/if}
