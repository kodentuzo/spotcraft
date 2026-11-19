import { error } from '@sveltejs/kit'
import { ICON_MAX_BYTES, iconType, readLimited } from '#lib/icon.ts'
import { getApp } from '#lib/server/agent.ts'
import type { RequestHandler } from './$types'

interface Icon {
  body: Uint8Array<ArrayBuffer>
  type: string
}

// Icons rarely change: each is kept for an hour. A miss may be a blip, so it is kept for five
// minutes. Keyed by app and host, so a new domain fetches afresh.
const TTL = 60 * 60 * 1000
const MISS_TTL = 5 * 60 * 1000
const cache = new Map<string, { until: number; icon: Icon | null }>()

function remember(key: string, icon: Icon | null) {
  const now = Date.now()
  // Drop what has expired (a removed app's icon included) before adding.
  for (const [k, entry] of cache) if (entry.until <= now) cache.delete(k)
  cache.set(key, { until: now + (icon ? TTL : MISS_TTL), icon })
}

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
      if (!response.ok || !type) {
        await response.body?.cancel()
        continue
      }
      const body = await readLimited(response, ICON_MAX_BYTES)
      if (body && body.byteLength > 0) return { body: new Uint8Array(body), type }
    } catch {
      // Unreachable, slow or redirected: try the next path, then show the initial.
    }
  }
  return null
}

/** The app's icon from its own site, for the home page's tile; 404 when it has none. */
export const GET: RequestHandler = async ({ params, url }) => {
  // `?host=` is the host the page drew the tile for: only a cache key (a new domain gets a new
  // URL), never where the icon is fetched from, which comes from the agent.
  const key = `${params.name} ${url.searchParams.get('host') ?? ''}`
  let entry = cache.get(key)
  if (!entry || entry.until <= Date.now()) {
    const app = await getApp(params.name)
    if (!app) error(404, 'No such app')
    const host = app.domain ?? app.hostnames[0]
    // Behind Access the site answers with a sign-in page, not its icon.
    remember(key, host && !app.protected ? await fetchIcon(host) : null)
    entry = cache.get(key)
  }
  if (!entry?.icon) error(404, 'No icon')
  return new Response(entry.icon.body, {
    headers: {
      'content-type': entry.icon.type,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  })
}
