import { error } from '@sveltejs/kit'
import { ICON_MAX_BYTES, iconType } from '#lib/icon.ts'
import { getApp } from '#lib/server/agent.ts'
import type { RequestHandler } from './$types'

interface Icon {
  body: ArrayBuffer
  type: string
}

// Icons rarely change: each app's (or its absence) is kept for an hour.
const TTL = 60 * 60 * 1000
const cache = new Map<string, { at: number; icon: Icon | null }>()

// A touch icon is bigger and sharper than a favicon; either will do.
const PATHS = ['/apple-touch-icon.png', '/favicon.ico']

async function fetchIcon(host: string): Promise<Icon | null> {
  for (const path of PATHS) {
    try {
      // No redirects: the app decides only what its own host answers, never where we go.
      const response = await fetch(`https://${host}${path}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(3_000),
      })
      const type = iconType(response.headers.get('content-type'))
      if (!response.ok || !type) continue
      const body = await response.arrayBuffer()
      if (body.byteLength > 0 && body.byteLength <= ICON_MAX_BYTES) return { body, type }
    } catch {
      // Unreachable, slow or redirected: try the next path, then show the initial.
    }
  }
  return null
}

/** The app's icon from its own site, for the home page's tile; 404 when it has none. */
export const GET: RequestHandler = async ({ params }) => {
  const { name } = params
  let entry = cache.get(name)
  if (!entry || Date.now() - entry.at > TTL) {
    const app = await getApp(name)
    if (!app) error(404, 'No such app')
    const host = app.domain ?? app.hostnames[0]
    // Behind Access the site answers with a sign-in page, not its icon.
    const icon = host && !app.protected ? await fetchIcon(host) : null
    entry = { at: Date.now(), icon }
    cache.set(name, entry)
  }
  if (!entry.icon) error(404, 'No icon')
  return new Response(entry.icon.body, {
    headers: {
      'content-type': entry.icon.type,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  })
}
