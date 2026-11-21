<script lang="ts">
  import UsersView from '#lib/components/UsersView.svelte'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()
</script>

<svelte:head><title>Users · Spotcraft</title></svelte:head>

<h1 class="mb-1 font-heading text-2xl font-bold">Users</h1>
<p class="mb-6 text-sm text-muted-foreground">Every app shares one user pool. Guests are visitors who haven't signed up.</p>

<UsersView page={data.page} listError={data.listError} accounts={data.accounts} cursor={data.cursor} now={data.now} {form} />
