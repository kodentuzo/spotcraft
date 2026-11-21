/**
 * The sidebar's sections. Each has two scopes: every app (`/usage`) and one app (`/blog/usage`);
 * Overview's are the app list (`/`) and the app's page (`/blog`).
 */
export const SECTIONS = [
  [
    { id: 'overview', label: 'Overview' },
    { id: 'usage', label: 'Usage' },
    { id: 'logs', label: 'Logs' },
    { id: 'server', label: 'Server' },
  ],
  [
    { id: 'domains', label: 'Domains' },
    { id: 'backups', label: 'Backups' },
    { id: 'users', label: 'Users' },
    { id: 'settings', label: 'Settings' },
  ],
] as const

export type Section = (typeof SECTIONS)[number][number]['id']
const IDS: readonly string[] = SECTIONS.flat().map((s) => s.id)
// Top-level paths that are the dashboard's own, never an app (the agent reserves them).
const OWN = new Set([...IDS, 'new', 'login', 'logout', 'api', 'hooks', 'apps'])

/** Where a section is, for every app or for one: the app first, then the page. */
export function hrefFor(section: Section, app?: string): string {
  const name = app ? `/${encodeURIComponent(app)}` : ''
  if (section === 'overview') return name || '/'
  return `${name}/${section}`
}

/**
 * The section and app a path is about. Adding or editing an app counts as its Overview; a path
 * outside the sections (login, say) has none.
 */
export function scopeOf(path: string): { section?: Section; app?: string; page?: 'new' | 'edit' } {
  if (path === '/') return { section: 'overview' }
  const [first, second] = path.split('/').slice(1).map(decodeURIComponent)
  if (first === 'new') return { section: 'overview', page: 'new' }
  if (OWN.has(first)) return IDS.includes(first) ? { section: first as Section } : {}
  if (second === 'edit') return { section: 'overview', app: first, page: 'edit' }
  if (second && IDS.includes(second)) return { section: second as Section, app: first }
  return { section: 'overview', app: first }
}

/** The header bar's title. */
export function titleFor(path: string): string {
  const { section, app, page } = scopeOf(path)
  if (page === 'new') return 'New app'
  if (page === 'edit') return 'Edit'
  if (section === 'overview' && !app) return 'Apps'
  return SECTIONS.flat().find((s) => s.id === section)?.label ?? ''
}

/** Where the switcher goes: the same section, for the app picked (or every app). */
export function switchHref(path: string, app?: string): string {
  return hrefFor(scopeOf(path).section ?? 'overview', app)
}

/** Where an old link (`/apps/blog`, `/apps/blog?tab=usage`, `/apps/new`) now lives. */
export function movedHref(rest: string, tab: string | null): string {
  const [first, ...more] = rest.split('/').filter(Boolean)
  if (!first) return '/'
  if (first === 'new') return '/new'
  if (more.length === 0 && (tab === 'usage' || tab === 'settings' || tab === 'logs')) {
    return hrefFor(tab, first)
  }
  return `/${[first, ...more].map(encodeURIComponent).join('/')}`
}
