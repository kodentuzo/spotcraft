import { fail } from '@sveltejs/kit'
import { backupNow, getBackup, getSettings, listBackups, restoreBackup } from '#lib/server/agent.ts'
import { appOr404 } from '#lib/server/app-data.ts'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
  const [app, settings, last] = await Promise.all([
    appOr404(params.name),
    getSettings().catch(() => undefined),
    getBackup(params.name).catch(() => 'unavailable' as const),
  ])
  const enabled = Boolean(settings?.backups)
  // The ones in the bucket, to restore from (ADR 0043); only for an app with a database.
  const backups =
    enabled && app.database
      ? await listBackups(params.name).catch(() => 'unavailable' as const)
      : []
  // Backups (ADR 0030): off when the server has none set up.
  return { app, enabled, last, backups }
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
  // A backup of the current data, the restore, then a deploy (ADR 0043).
  restore: async ({ params, request }) => {
    const data = await request.formData()
    const key = String(data.get('key') ?? '')
    // Only shown back in the message; the agent checks the key.
    const at = String(data.get('at') ?? '')
    try {
      return { restored: await restoreBackup(params.name, key), at }
    } catch (cause) {
      return fail(502, {
        restoreError: cause instanceof Error ? cause.message : 'The restore failed',
      })
    }
  },
}
