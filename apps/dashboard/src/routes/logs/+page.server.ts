import { NAME } from '@spotcraft/agent/app-spec'
import { redirect } from '@sveltejs/kit'
import { mergeLogs } from '#lib/logs.ts'
import { AgentUnavailable, appLogs, listApps } from '#lib/server/agent.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ url }) => {
  // The app is in the path now (`/logs/blog`); keep `?app=` links working.
  const asked = url.searchParams.get('app')
  if (asked && new RegExp(NAME).test(asked)) redirect(308, `/logs/${asked}`)
  try {
    const apps = (await listApps()).map((app) => app.name).sort()
    const logs = await Promise.all(apps.map((name) => appLogs(name, 100)))
    return {
      apps,
      lines: mergeLogs(Object.fromEntries(apps.map((name, i) => [name, logs[i]]))),
      agentError: null,
    }
  } catch (error) {
    const message =
      error instanceof AgentUnavailable ? error.message : 'The agent returned an error'
    return { apps: [], lines: [], agentError: message }
  }
}
