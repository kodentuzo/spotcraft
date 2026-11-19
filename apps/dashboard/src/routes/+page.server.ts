import type { DomainStatus } from '@spotcraft/agent/app-spec'
import { byApp, sortApps, sumHosts } from '#lib/overview.ts'
import {
  AgentUnavailable,
  type AppStatus,
  type BackupStatus,
  getBackups,
  getDomainStatus,
  getUsage,
  listApps,
} from '#lib/server/agent.ts'
import { instant, instantBy, promql, rangeBy, type Series } from '#lib/server/metrics.ts'
import { writeProbes } from '#lib/server/probes.ts'
import type { PageServerLoad } from './$types'

interface Server {
  memory: number | null
  memoryTotal: number | null
  disk: number | null
  diskTotal: number | null
}

/** Per-app figures that ask the agent more (Umami, Cloudflare): streamed. */
interface Details {
  requests: Record<string, number>
  /** Visitors in the last 7 days; missing when the app isn't counted. */
  visitors: Record<string, number>
  /** The app's custom hosts that don't take traffic yet. */
  domains: Record<string, string[]>
}

interface AppsPage {
  apps: AppStatus[]
  /** Uptime over 24 hours, and per hour for the bars. */
  uptime: Record<string, number>
  uptimeHourly: Record<string, Series>
  /** Memory in use now, in bytes. */
  memory: Record<string, number>
  /**
   * Each app's last backup, when backups are set up (ADR 0030); `unavailable` when the agent
   * couldn't say, which the page shows rather than hiding it.
   */
  backups: Record<string, BackupStatus | null> | null | 'unavailable'
  server: Server
  details: Promise<Details> | null
  agentError: string | null
}

const notActive = (status: DomainStatus | undefined) =>
  (status?.hosts ?? [])
    .filter((host) => host.state === 'pending' || host.state === 'missing')
    .map((host) => host.host)

export const load: PageServerLoad = async (): Promise<AppsPage> => {
  // Best-effort, like every metric: null without VictoriaMetrics, never a throw.
  const metrics = Promise.all([
    instant(promql.hostMemory),
    instant(promql.hostMemoryTotal),
    instant(promql.hostDisk),
    instant(promql.hostDiskTotal),
    instantBy(promql.uptimeByApp('24h'), 'app'),
    rangeBy(promql.uptimeHourlyByApp, 'app', 24 * 60, 3600),
    instantBy(promql.memoryByProject, 'container_label_com_docker_compose_project'),
  ])
  try {
    const [listed, backups, m] = await Promise.all([
      listApps(),
      getBackups().catch(() => 'unavailable' as const),
      metrics,
    ])
    const [memory, memoryTotal, disk, diskTotal, uptime, uptimeHourly, appMemory] = m
    const apps = sortApps(listed)
    // Keep uptime probes in step with the app list, even if an app was changed elsewhere.
    await writeProbes(apps).catch(() => {})
    const shown = backups === 'unavailable' ? backups : backups.enabled ? backups.apps : null
    const details = Promise.all([
      instantBy(promql.requestsDayByHost, 'host'),
      Promise.all(apps.map((app) => getUsage(app.name).catch(() => ({})))),
      Promise.all(
        apps.map((app) =>
          app.domain ? getDomainStatus(app.name).catch(() => undefined) : undefined,
        ),
      ),
    ]).then(([requests, usage, domains]) => ({
      requests: sumHosts(apps, requests),
      visitors: Object.fromEntries(
        apps.flatMap((app, i) => {
          const visits = 'visits' in usage[i] ? usage[i].visits : undefined
          return visits ? [[app.name, visits.visitors]] : []
        }),
      ),
      domains: Object.fromEntries(
        apps
          .map((app, i) => [app.name, notActive(domains[i])] as const)
          .filter(([, hosts]) => hosts.length),
      ),
    }))
    return {
      apps,
      uptime,
      uptimeHourly,
      memory: byApp(apps, appMemory),
      backups: shown,
      server: { memory, memoryTotal, disk, diskTotal },
      details,
      agentError: null,
    }
  } catch (error) {
    const message =
      error instanceof AgentUnavailable ? error.message : 'The agent returned an error'
    const [memory, memoryTotal, disk, diskTotal] = await metrics
    return {
      apps: [],
      uptime: {},
      uptimeHourly: {},
      memory: {},
      backups: null,
      server: { memory, memoryTotal, disk, diskTotal },
      details: null,
      agentError: message,
    }
  }
}
