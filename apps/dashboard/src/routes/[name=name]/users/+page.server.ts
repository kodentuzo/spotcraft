import { appOr404 } from '#lib/server/app-data.ts'
import { deleteUserAction, loadUsers } from '#lib/server/users.ts'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, url }) => {
  const [app, users] = await Promise.all([
    appOr404(params.name),
    loadUsers(url.searchParams.get('cursor') ?? undefined, params.name),
  ])
  return { app, ...users }
}

export const actions: Actions = {
  delete: ({ request }) => deleteUserAction(request),
}
