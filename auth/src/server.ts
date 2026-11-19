import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { toNodeHandler } from 'better-auth/node'
import type { Config } from './config.ts'
import { BASE_PATH, type Pool, type Pools } from './pool.ts'

/** Headers a bearer client needs to read from responses: the session token and the JWT. */
const EXPOSED = 'set-auth-token, set-auth-jwt'

/**
 * CORS for clients on another origin (Expo, a site not on Spotcraft yet), only for the
 * configured origins. Requests from an app's own domain are same-origin and need none.
 * Returns true when it answered a preflight.
 */
function cors(req: IncomingMessage, res: ServerResponse, config: Config): boolean {
  const origin = req.headers.origin
  if (!origin || !config.trustedOrigins.includes(origin)) return false
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Expose-Headers', EXPOSED)
  res.setHeader('Vary', 'Origin')
  if (req.method !== 'OPTIONS') return false
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  res.setHeader('Access-Control-Max-Age', '600')
  res.writeHead(204).end()
  return true
}

/**
 * The pool's HTTP server: Better Auth under `/_spotcraft/auth`, and `/health`, which answers
 * 200 once `ready()` resolves true (migrated and connected).
 */
export function createAuthServer(
  pools: Pools,
  config: Config,
  ready: () => Promise<boolean>,
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
