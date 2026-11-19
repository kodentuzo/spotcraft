import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { toNodeHandler } from 'better-auth/node'
import type { Config } from './config.ts'
import { resign } from './former.ts'
import { BASE_PATH, isLocalOrigin, type Pool, type Pools } from './pool.ts'

/** Headers a bearer client needs to read from responses: the session token and the JWT. */
const EXPOSED = 'set-auth-token, set-auth-jwt'

/**
 * CORS for clients on another origin (Expo, a site not on Spotcraft yet), only for the
 * configured origins. Requests from an app's own domain are same-origin and need none.
 * Returns true when it answered a preflight.
 */
function cors(req: IncomingMessage, res: ServerResponse, config: Config): boolean {
  const origin = req.headers.origin
  const trusted =
    config.trustedOrigins.includes(origin ?? '') || (config.localOrigins && isLocalOrigin(origin))
  if (!origin || !trusted) return false
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Expose-Headers', EXPOSED)
  res.setHeader('Vary', 'Origin')
  if (req.method !== 'OPTIONS') return false
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, spotcraft-client')
  res.setHeader('Access-Control-Max-Age', '600')
  res.writeHead(204).end()
  return true
}

/**
 * The pool's HTTP server: Better Auth under `/_spotcraft/auth`, and `/health`, which answers
 * 200 once `ready()` resolves true (migrated and connected). A session cookie signed with one
 * of `formerSecrets()` (an app that moved into the pool) is re-signed first (`former.ts`).
 */
export function createAuthServer(
  pools: Pools,
  config: Config,
  ready: () => Promise<boolean>,
  formerSecrets: () => Promise<string[]> = async () => [],
): Server {
  const handlers = new WeakMap<Pool, ReturnType<typeof toNodeHandler>>()
  return createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (path === '/health') {
      const ok = await ready().catch(() => false)
      res.writeHead(ok ? 200 : 503, { 'content-type': 'text/plain' }).end(ok ? 'ok' : 'starting')
      return
    }
    if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) {
      const pool = pools(req.headers.host ?? '')
      if (!pool) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('Bad host')
        return
      }
      if (cors(req, res, config)) return
      const resigned = req.headers.cookie?.includes('session_token')
        ? resign(req.headers.cookie, config.secret, await formerSecrets())
        : undefined
      if (resigned) {
        req.headers.cookie = resigned.cookie
        // Better Auth replaces it when it sets cookies itself (a renewal, a sign-out).
        res.setHeader('set-cookie', resigned.setCookie)
      }
      let handle = handlers.get(pool)
      if (!handle) {
        handle = toNodeHandler(pool)
        handlers.set(pool, handle)
      }
      await handle(req, res)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
  })
}
