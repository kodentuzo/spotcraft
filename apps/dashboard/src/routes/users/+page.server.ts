import { deleteUserAction, loadUsers } from '#lib/server/users.ts'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = ({ url }) =>
  loadUsers(url.searchParams.get('cursor') ?? undefined)

export const actions: Actions = {
  delete: ({ request }) => deleteUserAction(request),
}
