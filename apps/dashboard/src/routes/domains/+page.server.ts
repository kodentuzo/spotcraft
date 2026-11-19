import { customHosts, type DomainStatus } from '@spotcraft/agent/app-spec'
import { AgentUnavailable, getDomainStatus, listApps } from '#lib/server/agent.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  try {
    const apps = (await listApps()).sort((a, b) => a.name.localeCompare(b.name))
    // Custom domains ask Cloudflare (several calls each): streamed, per app.
    const custom: Record<string, Promise<DomainStatus | undefined>> = Object.fromEntries(
      apps
        .filter((app) => app.domain)
        .map((app) => [app.name, getDomainStatus(app.name).catch(() => undefined)] as const),
    )
    return {
      // The hosts Spotcraft gives every app; custom ones come with their DNS status.
      apps: apps.map((app) => ({
        name: app.name,
        domain: app.domain,
        hostnames: app.hostnames,
        own: app.hostnames.filter((host) => !customHosts(app).includes(host)),
      })),
      custom,
      agentError: null,
    }
  } catch (error) {
    const message =
      error instanceof AgentUnavailable ? error.message : 'The agent returned an error'
    return {
      apps: [],
      custom: {} as Record<string, Promise<DomainStatus | undefined>>,
      agentError: message,
    }
  }
}
