import { AgentUnavailable, getUsage, listApps } from '#lib/server/agent.ts'
import { instantBy, promql, rangeBy } from '#lib/server/metrics.ts'
import { seriesDays } from '#lib/usage.ts'
import type { PageServerLoad } from './$types'

/** Every app's usage over the last 7 days, and the requests to its hosts. */
export const load: PageServerLoad = async () => {
  try {
    const apps = (await listApps()).sort((a, b) => a.name.localeCompare(b.name))
    const [usage, week, previousWeek, perDay] = await Promise.all([
      Promise.all(apps.map((app) => getUsage(app.name).catch(() => ({})))),
      instantBy(promql.requestsWeekByHost(), 'host'),
      instantBy(promql.requestsWeekByHost(true), 'host'),
      // Seven points a day apart, each the day before it, the last ending now.
      rangeBy(promql.requestsPerDayByHost, 'host', 6 * 24 * 60, 86400),
    ])
    // Only the apps' own hosts count: not the dashboard's or the user pool's.
    const sum = (byHost: Record<string, number>, hosts: string[]) =>
      hosts.some((host) => byHost[host] !== undefined)
        ? hosts.reduce((total, host) => total + (byHost[host] ?? 0), 0)
        : null
    return {
      now: Date.now(),
      apps: apps.map((app, i) => {
        const counted = usage[i]
        const visits = 'visits' in counted ? counted.visits : undefined
        return {
          name: app.name,
          host: app.domain ?? app.hostnames[0],
          visits: visits
            ? {
                visitors: visits.visitors,
                views: visits.views,
                previous: visits.previous,
                perDay: visits.perDay ?? [],
              }
            : null,
          requests: {
            week: sum(week, app.hostnames),
            previousWeek: sum(previousWeek, app.hostnames),
            perDay: app.hostnames.map((host) => seriesDays(perDay[host] ?? [])),
          },
        }
      }),
      agentError: null,
    }
  } catch (error) {
    const message =
      error instanceof AgentUnavailable ? error.message : 'The agent returned an error'
    return { now: Date.now(), apps: [], agentError: message }
  }
}
