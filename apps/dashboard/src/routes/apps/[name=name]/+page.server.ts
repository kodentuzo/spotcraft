import { NAME, TAG } from '@spotcraft/agent/app-spec'
import { error, fail, redirect } from '@sveltejs/kit'
import {
  appLogs,
  backupNow,
  createHookToken,
  databaseLayout,
  deleteHookToken,
  deployApp,
  getApp,
  getBackup,
  getDomainStatus,
  getSettings,
  getUsage,
  hookEnabled,
  listApps,
  moveApp,
  removeApp,
} from '#lib/server/agent.ts'
import { instant, promql, range } from '#lib/server/metrics.ts'
import { writeProbes } from '#lib/server/probes.ts'
import { specOf } from '#lib/spec.ts'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, url, untrack }) => {
  const { name } = params
  // The name goes into PromQL and agent URLs before the app is looked up: only valid names.
  if (!new RegExp(NAME).test(name)) error(404, 'No such app')
  // Everything starts at once; only the 404 waits for the app itself.
  const [
    app,
    cpu,
    memory,
    response,
    up,
    uptimeDay,
    uptimeWeek,
    uptimeHourly,
    logs,
    hook,
    settings,
    backup,
    layout,
  ] = await Promise.all([
    getApp(name),
    range(promql.appCpu(name)),
    range(promql.appMemory(name)),
    range(promql.appResponse(name)),
    instant(promql.appUp(name)),
    instant(promql.appUptime(name, '24h')),
    instant(promql.appUptime(name, '7d')),
    range(promql.appUptimeHourly(name), 24 * 60, 3600),
    appLogs(name, 200),
    hookEnabled(name).catch(() => undefined),
    getSettings().catch(() => undefined),
    getBackup(name).catch(() => 'unavailable' as const),
    databaseLayout(name).catch(() => undefined),
  ])
  if (!app) error(404, 'No such app')
  // The domain's status asks Cloudflare (several calls): streamed, so the page doesn't wait.
  const domain = app.domain ? getDomainStatus(name).catch(() => undefined) : undefined
  // Usage (ADR 0038) asks Umami and the pool through the agent: streamed too.
  // An app with no address (no APPS_DOMAIN, no domain of its own) gets no requests.
  const hosts = app.hostnames
  const when = <T>(ask: () => Promise<T>, none: T) =>
    hosts.length > 0 ? ask() : Promise.resolve(none)
  const usage = Promise.all([
    getUsage(name).catch(() => ({})),
    when(() => instant(promql.appRequestsDay(hosts)), null),
    when(() => instant(promql.appErrorsDay(hosts)), null),
    when(() => instant(promql.appLatencyP95(hosts)), null),
    when(() => range(promql.appRequestsPerHour(hosts), 24 * 60, 3600), []),
    when(() => instant(promql.appRequestsWeek(hosts)), null),
    when(() => instant(promql.appRequestsWeek(hosts, true)), null),
    // Seven points a day apart, each the day before it, the last ending now.
    when(() => range(promql.appRequestsPerDay(hosts), 6 * 24 * 60, 86400), []),
  ]).then(([counted, requests, errors, p95, perHour, week, previousWeek, perDay]) => ({
    ...counted,
    requests: { day: requests, errors, p95, perHour, week, previousWeek, perDay },
  }))
  return {
    app,
    metrics: { cpu, memory, response, up, uptimeDay, uptimeWeek, uptimeHourly },
    logs,
    domain,
    usage,
    // Always https: behind the tunnel the dashboard itself sees plain HTTP.
    // Untracked: switching tabs (`?tab=`) changes the URL but needs no new data.
    hook: { enabled: hook, url: `https://${untrack(() => url.host)}/hooks/deploy/${name}` },
    // Backups (ADR 0030): null when the server has none set up.
    backup: settings?.backups ? { last: backup } : null,
    // When the page was made, so server and browser draw the same hours.
    now: Date.now(),
    // An app made before ADR 0034 still has its own database, until it moves.
    ownDatabase: layout === 'database',
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
