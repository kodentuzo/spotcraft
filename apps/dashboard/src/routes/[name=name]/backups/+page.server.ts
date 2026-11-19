import { fail } from '@sveltejs/kit'
import { backupNow, getBackup, getSettings } from '#lib/server/agent.ts'
import { appOr404 } from '#lib/server/app-data.ts'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
  const [app, settings, last] = await Promise.all([
    appOr404(params.name),
    getSettings().catch(() => undefined),
    getBackup(params.name).catch(() => 'unavailable' as const),
  ])
  // Backups (ADR 0030): off when the server has none set up.
  return { app, enabled: Boolean(settings?.backups), last }
}

export const actions: Actions = {
  // Waits its turn behind deploys, then dumps and uploads (ADR 0030).
  backup: async ({ params }) => {
    try {
      return { backedUp: await backupNow(params.name) }
    } catch (cause) {
      return fail(502, {
        backupError: cause instanceof Error ? cause.message : 'The backup failed',
      })
    }
  },
}
