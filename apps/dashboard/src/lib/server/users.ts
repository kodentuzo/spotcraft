import { fail } from '@sveltejs/kit'
import { listErrorMessage } from '#lib/users.ts'
import { deleteUser, getPoolUsage, getUsage, listUsers } from './agent.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The Users page's data, for the whole pool or one app (ADR 0040): a page of users, and the
 * account counts (streamed: they ask the pool several things).
 */
export async function loadUsers(cursor: string | undefined, app?: string) {
  // Handled at once: a failure while the list below is awaited would otherwise be unhandled,
  // which ends the process.
  const accounts = (app ? getUsage(app) : getPoolUsage())
    .then((usage) => usage.accounts ?? null)
    .catch(() => null)
  let page: Awaited<ReturnType<typeof listUsers>> | null = null
  let listError: string | null = null
  try {
    page = (await listUsers(cursor, app)) ?? null
  } catch (error) {
    listError = listErrorMessage(error, app)
  }
  return {
    page,
    listError,
    cursor: cursor ?? null,
    accounts,
    now: Date.now(),
  }
}

/** Deletes a user from the whole pool, from either Users page. */
export async function deleteUserAction(request: Request) {
  const id = String((await request.formData()).get('id') ?? '')
  if (!UUID.test(id)) return fail(400, { deleteError: 'Not a user id.' })
  try {
    if (!(await deleteUser(id))) return fail(404, { deleteError: 'That user no longer exists.' })
  } catch (error) {
    // E.g. an app's foreign key that keeps rows for the user (a bug in that app).
    return fail(409, { deleteError: error instanceof Error ? error.message : String(error) })
  }
  return { deleted: id }
}
