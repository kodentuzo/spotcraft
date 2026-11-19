/**
 * The sidebar's sections. Each has two scopes: every app (`/usage`) and one app (`/usage/blog`);
 * Overview's are the app list (`/`) and the app's page (`/apps/blog`).
 */
export const SECTIONS = [
  [
    { id: 'overview', label: 'Overview', icon: 'apps' },
    { id: 'usage', label: 'Usage', icon: 'usage' },
    { id: 'logs', label: 'Logs', icon: 'logs' },
    { id: 'server', label: 'Server', icon: 'server' },
  ],
  [
    { id: 'domains', label: 'Domains', icon: 'globe' },
    { id: 'backups', label: 'Backups', icon: 'archive' },
    { id: 'users', label: 'Users', icon: 'users' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ],
] as const

export type Section = (typeof SECTIONS)[number][number]['id']
const IDS: readonly string[] = SECTIONS.flat().map((s) => s.id)

/** Where a section is, for every app or for one. */
export function hrefFor(section: Section, app?: string): string {
  const name = app ? encodeURIComponent(app) : undefined
  if (section === 'overview') return name ? `/apps/${name}` : '/'
  return name ? `/${section}/${name}` : `/${section}`
}

/**
 * The section and app a path is about. Adding or editing an app counts as its Overview; a path
 * outside the sections (login, say) has none.
 */
export function scopeOf(path: string): { section?: Section; app?: string; page?: 'new' | 'edit' } {
  if (path === '/') return { section: 'overview' }
  const [first, second, third] = path.split('/').slice(1).map(decodeURIComponent)
  if (first === 'apps') {
    if (second === 'new') return { section: 'overview', page: 'new' }
    return {
      section: 'overview',
      app: second,
      ...(third === 'edit' ? { page: 'edit' as const } : {}),
    }
  }
  if (IDS.includes(first)) return { section: first as Section, ...(second ? { app: second } : {}) }
  return {}
}

/** The header bar's title. */
export function titleFor(path: string): string {
  const { section, page } = scopeOf(path)
  if (page === 'new') return 'New app'
  if (page === 'edit') return 'Edit'
  if (section === 'overview' && !scopeOf(path).app) return 'Apps'
  return SECTIONS.flat().find((s) => s.id === section)?.label ?? ''
}

/** Where the switcher goes: the same section, for the app picked (or every app). */
export function switchHref(path: string, app?: string): string {
  return hrefFor(scopeOf(path).section ?? 'overview', app)
}

/** Where an old app tab link (`/apps/blog?tab=usage`) now lives; undefined for Overview. */
export function tabHref(app: string, tab: string | null): string | undefined {
  if (tab === 'usage' || tab === 'settings' || tab === 'logs') return hrefFor(tab, app)
  return undefined
}
