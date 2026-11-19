/** A value for one UTC day (`YYYY-MM-DD`). */
export type DayPoint = { day: string; value: number }

const DAY = 86_400_000

/** The last `n` UTC days, oldest first, today last. */
export function lastDays(n: number, now = Date.now()): string[] {
  return Array.from({ length: n }, (_, i) =>
    new Date(now - (n - 1 - i) * DAY).toISOString().slice(0, 10),
  )
}

/** One point per day of `days`, 0 where `values` has none. */
export function fillDays(days: string[], values: DayPoint[]): DayPoint[] {
  const byDay = new Map(values.map((p) => [p.day, p.value]))
  return days.map((day) => ({ day, value: byDay.get(day) ?? 0 }))
}

/** A [unix seconds, value] series as day points, each labelled by its UTC day. */
export const seriesDays = (series: Array<[number, number]>): DayPoint[] =>
  series.map(([t, value]) => ({ day: new Date(t * 1000).toISOString().slice(0, 10), value }))

/** How `now` changed from `before`, as a whole percentage; null when there is nothing to compare. */
export function change(
  now: number | null | undefined,
  before: number | null | undefined,
): number | null {
  if (now === null || now === undefined || !before) return null
  return Math.round(((now - before) / before) * 100)
}

/** A round top for a chart's axis of counts, and the whole step between its lines (about three). */
export function axis(max: number): { top: number; step: number } {
  if (max <= 3) return { top: 3, step: 1 }
  const rough = max / 3
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude
  return { top: Math.ceil(max / step) * step, step }
}

/** "Nov 13" for a `YYYY-MM-DD` day. */
export const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
