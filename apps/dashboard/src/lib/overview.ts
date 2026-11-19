import { projectName } from '@spotcraft/agent/app-spec'
import { statusView } from './status.ts'

/** The fields of an app the home page sorts and counts by. */
interface Listed {
  name: string
  state: string
  health: string
  hostnames: string[]
}

/** Apps that need a look first, then by name. */
export function sortApps<T extends Listed>(apps: T[]): T[] {
  return [...apps].sort((a, b) => {
    const bad =
      Number(statusView(b.state, b.health).bad) - Number(statusView(a.state, a.health).bad)
    return bad || a.name.localeCompare(b.name)
  })
}

/** The apps whose container isn't running well, by name. */
export const troubled = (apps: Listed[]) =>
  apps.filter((app) => statusView(app.state, app.health).bad).map((app) => app.name)

/** Values keyed by Compose project (`spotcraft-app-<name>`), re-keyed by app name. */
export function byApp<V>(apps: Listed[], byProject: Record<string, V>): Record<string, V> {
  const out: Record<string, V> = {}
  for (const app of apps) {
    const value = byProject[projectName(app.name)]
    if (value !== undefined) out[app.name] = value
  }
  return out
}

/** Per-host counts summed over each app's hosts; an app with no counted host is left out. */
export function sumHosts(apps: Listed[], byHost: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const app of apps) {
    const counted = app.hostnames.filter((host) => byHost[host] !== undefined)
    if (counted.length > 0) out[app.name] = counted.reduce((sum, host) => sum + byHost[host], 0)
  }
  return out
}

/** A memory limit as the agent takes it (`512m`, `1g`) in bytes; null if it isn't one. */
export function memoryLimit(limit: string): number | null {
  const match = /^(\d+)([mg])$/.exec(limit)
  if (!match) return null
  return Number(match[1]) * 1024 ** (match[2] === 'g' ? 3 : 2)
}

/** One bar per hour of the last `hours`, oldest first; null where there's no probe data. */
export function hourlyBars(
  series: Array<[number, number]>,
  now: number,
  hours = 24,
): Array<{ at: number; ratio: number | null }> {
  const end = Math.floor(now / 3600) * 3600
  const byHour = new Map(series.map(([t, v]) => [Math.floor(t / 3600) * 3600, v]))
  return Array.from({ length: hours }, (_, i) => {
    const at = end - (hours - 1 - i) * 3600
    return { at, ratio: byHour.get(at) ?? null }
  })
}

/** Memory at or above this share of its limit shows as a warning. */
export const MEMORY_TIGHT = 0.9

/** How much of its limit (`512m`, `1g`) an app uses, 0–1; null when either is unknown. */
export function memoryShare(used: number | null | undefined, limit: string): number | null {
  const bytes = memoryLimit(limit)
  return used === null || used === undefined || !bytes ? null : used / bytes
}
