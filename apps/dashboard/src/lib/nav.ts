/** The dashboard's global pages, in the sidebar's two groups. */
export const SECTIONS = [
  [
    { href: '/', label: 'Apps', icon: 'apps' },
    { href: '/usage', label: 'Usage', icon: 'usage' },
    { href: '/logs', label: 'Logs', icon: 'logs' },
    { href: '/server', label: 'Server', icon: 'server' },
  ],
  [
    { href: '/domains', label: 'Domains', icon: 'globe' },
    { href: '/backups', label: 'Backups', icon: 'archive' },
    { href: '/users', label: 'Users', icon: 'users' },
    { href: '/settings', label: 'Settings', icon: 'settings' },
  ],
] as const

/** Whether a sidebar item is the current page: Apps also covers every app's pages. */
export function isCurrent(href: string, path: string): boolean {
  if (href === '/') return path === '/' || path.startsWith('/apps')
  return path === href || path.startsWith(`${href}/`)
}

const APP_TABS: Record<string, string> = { usage: 'Usage', settings: 'Settings', logs: 'Logs' }

/** The header bar's title for a path: on an app's page, its tab. */
export function titleFor(path: string, search?: Pick<URLSearchParams, 'get'>): string {
  if (path === '/') return 'Apps'
  if (path === '/apps/new') return 'New app'
  if (/^\/apps\/[^/]+\/edit$/.test(path)) return 'Edit'
  if (path.startsWith('/apps/')) return APP_TABS[search?.get('tab') ?? ''] ?? 'Overview'
  const item = SECTIONS.flat().find(
    (section) => section.href !== '/' && isCurrent(section.href, path),
  )
  return item?.label ?? 'Overview'
}

/** The app a path is about, from `/apps/<name>…` or `?app=` on Logs; undefined for all apps. */
export function currentApp(path: string, search: Pick<URLSearchParams, 'get'>): string | undefined {
  const match = /^\/apps\/([^/]+)/.exec(path)
  if (match && match[1] !== 'new') return match[1]
  if (path === '/logs') return search.get('app') ?? undefined
  return undefined
}

/** Where picking an app in the switcher goes: the same view for that app where there is one. */
export function switchHref(
  path: string,
  search: Pick<URLSearchParams, 'get'>,
  name: string,
): string {
  if (path === '/logs') return `/logs?app=${encodeURIComponent(name)}`
  const tab = path.startsWith('/apps/') ? search.get('tab') : null
  return `/apps/${encodeURIComponent(name)}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`
}
