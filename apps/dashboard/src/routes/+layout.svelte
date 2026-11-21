<script lang="ts">
  import './layout.css'
  import Plus from '@lucide/svelte/icons/plus'
  import { Button } from '@spotcraft/ui/components/button'
  import * as Sidebar from '@spotcraft/ui/components/sidebar'
  import favicon from '#lib/assets/favicon.svg'
  import AppSidebar from '#lib/components/AppSidebar.svelte'
  import AppSwitcher from '#lib/components/AppSwitcher.svelte'
  import { scopeOf, titleFor } from '#lib/nav.ts'
  import { page } from '$app/state'
  import type { LayoutProps } from './$types'

  let { data, children }: LayoutProps = $props()

  const path = $derived(page.url.pathname)
  const scope = $derived(scopeOf(path))
  const title = $derived(titleFor(path))
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{#if data.authed}
  <Sidebar.Provider>
    <AppSidebar {data} section={scope.section} app={scope.app} />

    <Sidebar.Inset class="min-w-0">
      <header class="sticky top-0 z-20 grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
        <div class="flex min-w-0 items-center gap-1">
          <Sidebar.Trigger class="-ml-1" />
          <AppSwitcher apps={data.apps} {path} app={scope.app} />
        </div>
        <p class="hidden text-sm font-medium sm:block">{title}</p>
        <div class="col-start-3 flex justify-end">
          <Button href="/new" variant="ghost" aria-label="Add app">
            <Plus /><span class="hidden sm:inline">Add app</span>
          </Button>
        </div>
      </header>

      <main class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        {@render children()}
      </main>
    </Sidebar.Inset>
  </Sidebar.Provider>
{:else}
  <main class="mx-auto max-w-5xl px-4 py-8">
    {@render children()}
  </main>
{/if}
