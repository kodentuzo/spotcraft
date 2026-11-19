/** One log line, with the app it came from and Docker's timestamp (ISO). */
export type LogLine = { app: string; at: string; text: string }

// Compose's `logs --timestamps`: `<container>  | <ISO time> <message>`.
const LINE = /^\S+\s+\|\s(\d{4}-\d\d-\d\dT[\d:.]+Z)\s?(.*)$/

/**
 * Several apps' logs as one list, oldest first, at most `limit` lines (the newest). A line
 * without a timestamp keeps the time of the line before it, so it stays in place.
 */
export function mergeLogs(byApp: Record<string, string>, limit = 200): LogLine[] {
  const lines: LogLine[] = []
  for (const [app, text] of Object.entries(byApp)) {
    let at = ''
    for (const raw of text.split('\n')) {
      if (!raw.trim()) continue
      const match = LINE.exec(raw)
      if (match) at = match[1]
      lines.push({ app, at, text: match ? match[2] : raw })
    }
  }
  // A stable sort keeps each app's own order among equal times.
  return lines.sort((a, b) => a.at.localeCompare(b.at)).slice(-limit)
}
