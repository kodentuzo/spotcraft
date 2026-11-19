import { error, fail, redirect } from '@sveltejs/kit'
import { tabHref } from '#lib/nav.ts'
import { deployApp, getApp, getBackup, getDomainStatus, getSettings } from '#lib/server/agent.ts'
import { appHealth, appOr404, appUsage } from '#lib/server/app-data.ts'
import { specOf } from '#lib/spec.ts'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, url }) => {
  const { name } = params
  // The app's tabs moved into the sidebar: old links go to their section.
  const moved = tabHref(name, url.searchParams.get('tab'))
  if (moved) redirect(308, moved)
  const [app, metrics, settings, backup] = await Promise.all([
    appOr404(name),
    appHealth(name),
    getSettings().catch(() => undefined),
    getBackup(name).catch(() => 'unavailable' as const),
  ])
  return {
    app,
    metrics,
    // The domain's status asks Cloudflare (several calls): streamed, so the page doesn't wait.
    domain: app.domain ? getDomainStatus(name).catch(() => undefined) : undefined,
    usage: appUsage(app),
    // Backups (ADR 0030): null when the server has none set up.
    backup: settings?.backups ? { last: backup } : null,
    // When the page was made, so server and browser draw the same hours.
    now: Date.now(),
  }
}

export const actions: Actions = {
  // Same settings again: pulls the tag (picks up a re-pushed `latest`) and restarts the app.
  redeploy: async ({ params }) => {
    const app = await getApp(params.name)
    if (!app) error(404, 'No such app')
    const result = await deployApp(app.name, specOf(app))
    if (!result.ok) return fail(502, { deployError: result.error, output: result.output })
    return { redeployed: true }
  },
}
