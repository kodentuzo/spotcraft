import { TAG } from '@spotcraft/agent/app-spec'
import { error, fail, redirect } from '@sveltejs/kit'
import {
  createHookToken,
  databaseLayout,
  deleteHookToken,
  hookEnabled,
  listApps,
  moveApp,
  removeApp,
} from '#lib/server/agent.ts'
import { appOr404 } from '#lib/server/app-data.ts'
import { writeProbes } from '#lib/server/probes.ts'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, url }) => {
  const { name } = params
  const [app, hook, layout] = await Promise.all([
    appOr404(name),
    hookEnabled(name).catch(() => undefined),
    databaseLayout(name).catch(() => undefined),
  ])
  return {
    app,
    // Always https: behind the tunnel the dashboard itself sees plain HTTP.
    hook: { enabled: hook, url: `https://${url.host}/hooks/deploy/${name}` },
    // An app made before ADR 0034 still has its own database, until it moves.
    ownDatabase: layout === 'database',
  }
}

export const actions: Actions = {
  // Into its schema and the user pool, with a version made for them (ADR 0035).
  move: async ({ params, request }) => {
    const tag = String((await request.formData()).get('tag') ?? '').trim()
    if (!new RegExp(TAG).test(tag))
      return fail(400, { moveError: 'Enter the tag of the new version', tag })
    try {
      return { moved: (await moveApp(params.name, tag)).moved }
    } catch (cause) {
      return fail(502, {
        moveError: cause instanceof Error ? cause.message : 'The move failed',
        tag,
      })
    }
  },
  // The deploy hook (ADR 0029): a new token, shown once, replaces any old one.
  createHook: async ({ params }) => {
    return { hookToken: await createHookToken(params.name) }
  },
  deleteHook: async ({ params }) => {
    await deleteHookToken(params.name)
    return { hookDeleted: true }
  },
  remove: async ({ params, request }) => {
    const purge = (await request.formData()).get('purge') === 'on'
    try {
      await removeApp(params.name, { purge })
    } catch (cause) {
      // E.g. the app was removed but its database could not be deleted: say exactly that.
      error(502, cause instanceof Error ? cause.message : 'The agent could not remove the app')
    } finally {
      await writeProbes(await listApps()).catch(() => {})
    }
    redirect(303, '/')
  },
}
