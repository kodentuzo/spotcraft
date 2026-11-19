import { NAME } from '@spotcraft/agent/app-spec'
import { fail } from '@sveltejs/kit'
import {
  AgentUnavailable,
  type BackupStatus,
  backupNow,
  getBackups,
  listApps,
} from '#lib/server/agent.ts'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  try {
    const [apps, backups] = await Promise.all([listApps(), getBackups()])
    return {
      enabled: backups.enabled,
      apps: apps
        .map((app) => ({
          name: app.name,
          host: app.domain ?? app.hostnames[0],
          database: app.database,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      last: backups.apps,
      agentError: null,
    }
  } catch (error) {
    const message =
      error instanceof AgentUnavailable ? error.message : 'The agent returned an error'
    return {
      enabled: false,
      apps: [],
      last: {} as Record<string, BackupStatus | null>,
      agentError: message,
    }
  }
}

export const actions: Actions = {
  // Waits its turn behind deploys, then dumps and uploads (ADR 0030).
  backup: async ({ request }) => {
    const name = String((await request.formData()).get('name') ?? '')
    if (!new RegExp(NAME).test(name)) return fail(400, { name, backupError: 'Not an app name' })
    try {
      return { name, backedUp: await backupNow(name) }
    } catch (cause) {
      return fail(502, {
        name,
        backupError: cause instanceof Error ? cause.message : 'The backup failed',
      })
    }
  },
}
