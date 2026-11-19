import { fail } from '@sveltejs/kit'
import { deleteUser, listUsers } from '#lib/server/agent.ts'
import type { Actions, PageServerLoad } from './$types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const load: PageServerLoad = async ({ url }) => {
  const cursor = url.searchParams.get('cursor') ?? undefined
  return { page: (await listUsers(cursor)) ?? null, cursor }
}

export const actions: Actions = {
  delete: async ({ request }) => {
    const id = String((await request.formData()).get('id') ?? '')
    if (!UUID.test(id)) return fail(400, { deleteError: 'Not a user id.' })
    try {
      if (!(await deleteUser(id))) return fail(404, { deleteError: 'That user no longer exists.' })
    } catch (error) {
      // E.g. an app's foreign key that keeps rows for the user (a bug in that app).
      return fail(409, { deleteError: error instanceof Error ? error.message : String(error) })
    }
    return { deleted: id }
  },
}
