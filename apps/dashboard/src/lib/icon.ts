/**
 * App icons for the home page's tiles. Raster types only: an SVG served from the dashboard's
 * own origin could run script if opened directly.
 */
export const ICON_TYPES = [
  'image/png',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/jpeg',
  'image/webp',
]

/** Bigger than any sensible favicon or touch icon. */
export const ICON_MAX_BYTES = 256 * 1024

/** The content type an icon response may be served with, or null to refuse it. */
export function iconType(header: string | null): string | null {
  const type = header?.split(';')[0].trim().toLowerCase() ?? ''
  return ICON_TYPES.includes(type) ? type : null
}

/** A hue (0–359) that stays the same for a name, for the tile's color. */
export function hue(name: string): number {
  // FNV-1a: similar names still land far apart.
  let hash = 2166136261
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  return hash % 360
}

/**
 * Reads a response body up to `max` bytes; null (and the rest cancelled) when it is longer,
 * so a huge answer never lands in memory.
 */
export async function readLimited(response: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length'))
  if (declared > max) {
    await response.body?.cancel()
    return null
  }
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    body.set(chunk, at)
    at += chunk.byteLength
  }
  return body
}
