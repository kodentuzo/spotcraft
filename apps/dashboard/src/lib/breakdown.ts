/** A breakdown row as the agent sends it: what, and how many. */
export type Row = { name: string; count: number }

/** A country's flag from its ISO code (regional indicator letters); empty for anything else. */
export function flag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

const regions = new Intl.DisplayNames(['en'], { type: 'region' })

/** A country's English name from its ISO code, or the code when it isn't one. */
export function countryName(code: string): string {
  try {
    return /^[A-Z]{2}$/.test(code) ? (regions.of(code) ?? code) : code
  } catch {
    return code
  }
}

/** Umami's device kinds read as words: "desktop" → "Desktop". */
export const capitalized = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)

/** Each row's share of `total`, as a whole percentage; 0 without a total. */
export const share = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
