import type { AppStatus } from '@spotcraft/agent/apps'
import { error } from '@sveltejs/kit'
import { getApp, getUsage } from './agent.ts'
import { instant, promql, range } from './metrics.ts'

/** The app, or a 404 page. The route's `[name=name]` matcher has already checked the name. */
export async function appOr404(name: string): Promise<AppStatus> {
  const app = await getApp(name)
  if (!app) error(404, 'No such app')
  return app
}

/** The app's container and probes: lines over the last `minutes`, one point per `step` seconds. */
export async function appHealth(name: string, minutes = 60, step = 60) {
  const [cpu, memory, response, up, uptimeDay, uptimeWeek, uptimeHourly] = await Promise.all([
    range(promql.appCpu(name), minutes, step),
    range(promql.appMemory(name), minutes, step),
    range(promql.appResponse(name), minutes, step),
    instant(promql.appUp(name)),
    instant(promql.appUptime(name, '24h')),
    instant(promql.appUptime(name, '7d')),
    range(promql.appUptimeHourly(name), 24 * 60, 3600),
  ])
  return { cpu, memory, response, up, uptimeDay, uptimeWeek, uptimeHourly }
}

/**
 * The app's usage (ADR 0038): Umami and the pool through the agent, and requests from Caddy's
 * metrics. Slow, so pages stream it. An app with no address gets no requests.
 */
export function appUsage(app: AppStatus) {
  const hosts = app.hostnames
  const when = <T>(ask: () => Promise<T>, none: T) =>
    hosts.length > 0 ? ask() : Promise.resolve(none)
  return Promise.all([
    getUsage(app.name).catch(() => ({})),
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
}
