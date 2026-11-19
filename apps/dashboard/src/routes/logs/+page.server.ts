import { NAME } from '@spotcraft/agent/app-spec'
import { error, isHttpError } from '@sveltejs/kit'
import { AgentUnavailable, appLogs, listApps } from '#lib/server/agent.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ url }) => {
  try {
    const apps = (await listApps()).map((app) => app.name).sort()
    const asked = url.searchParams.get('app')
    // The name goes into an agent URL: only a valid one, and only an app that exists.
    if (asked !== null && (!new RegExp(NAME).test(asked) || !apps.includes(asked))) {
      error(404, 'No such app')
    }
    const app = asked ?? apps[0] ?? null
    return { apps, app, logs: app ? await appLogs(app, 200) : '', agentError: null }
  } catch (cause) {
    if (isHttpError(cause)) throw cause
    const message =
      cause instanceof AgentUnavailable ? cause.message : 'The agent returned an error'
    return { apps: [], app: null, logs: '', agentError: message }
  }
}
