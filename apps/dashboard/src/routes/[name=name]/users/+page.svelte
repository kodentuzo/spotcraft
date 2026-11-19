<script lang="ts">
  import AppHeading from '#lib/components/AppHeading.svelte'
  import UsersView from '#lib/components/UsersView.svelte'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()

  const app = $derived(data.app)
</script>

<svelte:head><title>Users · {app.name} · Spotcraft</title></svelte:head>

<AppHeading title="Users" {app} />
<p class="-mt-3 mb-6 text-footnote text-muted-foreground">
  The users with a session on {app.name}'s addresses. Every app shares one user pool (<a href="/users" class="underline">all users</a>).
</p>

<UsersView page={data.page} listError={data.listError} accounts={data.accounts} cursor={data.cursor} now={data.now} {form} app={app.name} />
