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
