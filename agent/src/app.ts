import { createHash, timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyServerOptions } from 'fastify'
import type { AppBody } from './app-spec.ts'
import {
  appBodySchema,
  isReservedName,
  NAME,
  nameParamsSchema,
  PLATFORM_ENV,
  RESERVED_NAMES,
  servedHosts,
  TAG,
} from './app-spec.ts'
import { AgentError, type Apps } from './apps.ts'

export interface BuildOptions {
  token: string
  apps: Apps
  /** Client addresses allowed to call the agent; empty allows any (tests, local runs). */
  allowedIps?: string[]
  logger?: FastifyServerOptions['logger']
}

/** `::ffff:10.0.0.3` (an IPv4 client on a dual-stack socket) is `10.0.0.3`. */
const normalizeIp = (ip: string) => (ip.startsWith('::ffff:') ? ip.slice(7) : ip)

type NameParams = { name: string }

const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

const digest = (value: string) => createHash('sha256').update(value).digest()

export function buildApp({ token, apps, allowedIps = [], logger = false }: BuildOptions) {
  const app = Fastify({
    logger,
    bodyLimit: 256 * 1024,
    // Reject unknown fields instead of silently dropping them (Fastify's default).
    ajv: { customOptions: { removeAdditional: false } },
  })
  const expected = digest(`Bearer ${token}`)
  // Loopback is the container itself (its health check); nothing outside can reach it.
  const allowed = new Set([...allowedIps.map(normalizeIp), '127.0.0.1', '::1'])

  // Only the dashboard's server may talk to the agent at all: a hosted app's container can
  // reach this port through the host, and must be turned away before the token is checked.
  app.addHook('onRequest', async (request, reply) => {
    if (allowedIps.length > 0 && !allowed.has(normalizeIp(request.ip))) {
      request.log.warn({ ip: request.ip }, 'refused: address not allowed')
      return reply.code(403).send({ error: 'Forbidden' })
    }
  })

  // Every route but /health needs the dashboard's token. Comparing fixed-length digests in
  // constant time leaks neither the token nor its length.
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return
    const given = digest(request.headers.authorization ?? '')
    if (!timingSafeEqual(given, expected)) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AgentError) {
      request.log.warn({ output: error.output }, error.message)
      return reply.code(error.statusCode).send({ error: error.message, output: error.output })
    }
    const fastifyError = error as { validation?: unknown; message?: string; statusCode?: number }
    if (fastifyError.validation) {
      return reply.code(400).send({ error: fastifyError.message })
    }
    if (fastifyError.statusCode && fastifyError.statusCode < 500) {
      return reply.code(fastifyError.statusCode).send({ error: fastifyError.message })
    }
    request.log.error(error)
    return reply.code(500).send({ error: 'Internal error' })
  })

  app.get('/health', async () => ({ ok: true }))

  // What apps are served under, so the dashboard can show an app's address before it exists.
  app.get('/settings', async () => apps.settings)

  app.get('/apps', async () => ({ apps: await apps.list() }))

  app.get<{ Params: NameParams }>(
    '/apps/:name',
    { schema: { params: nameParamsSchema } },
    async (request, reply) => {
      const found = await apps.get(request.params.name)
      return found ?? reply.code(404).send({ error: 'No such app' })
    },
  )

  app.put<{ Params: NameParams; Body: AppBody }>(
    '/apps/:name',
    {
      schema: {
        params: nameParamsSchema,
        body: appBodySchema,
      },
    },
    async (request, reply) => {
      const { name } = request.params
      if (isReservedName(name)) {
        return reply.code(400).send({ error: `"${name}" is reserved` })
      }
      const current = await apps.get(name)
      // Every app has a schema on a server with Postgres (ADR 0034); `database` in the body is
      // accepted for older dashboards and ignored.
      const database = apps.hasDatabases
      const reserved = PLATFORM_ENV.filter((key) => key in request.body.env)
      if (reserved.length > 0) {
        return reply
          .code(400)
          .send({ error: `${reserved.join(', ')}: Spotcraft sets these; remove them from env` })
      }
      const { appsDomain } = apps.settings
      // Left out, `protected` keeps its current value, like `database`.
      const protect = request.body.protected ?? current?.protected ?? false
      if (protect && !apps.settings.access) {
        return reply
          .code(409)
          .send({ error: 'This server has no Cloudflare Access policy for protected apps' })
      }
      if (!appsDomain && !request.body.domain) {
        return reply
          .code(400)
          .send({ error: 'A domain is required: this server has no APPS_DOMAIN' })
      }
      // No host may belong to two apps: a custom domain can't be another app's default host,
      // nor the `www.` another app's root domain redirects.
      const wanted = servedHosts({ name, domain: request.body.domain }, appsDomain)
      // The dashboard shares Caddy: a site for its host would make Caddy refuse the whole
      // config (ADR 0026).
      const { dashboardDomain } = apps.settings
      if (dashboardDomain && wanted.includes(dashboardDomain)) {
        return reply.code(409).send({ error: `${dashboardDomain} is the dashboard's domain` })
      }
      // The apps domain's reserved hosts (`fallback.`, `www.`…) belong to Spotcraft: taking one
      // over would replace records OpenTofu manages, such as the custom-hostname fallback origin.
      const domain = request.body.domain
      if (appsDomain && domain) {
        const [label, ...rest] = domain.split('.')
        if (rest.join('.') === appsDomain && RESERVED_NAMES.has(label)) {
          return reply.code(409).send({ error: `${domain} is reserved on the apps domain` })
        }
      }
      for (const other of await apps.list()) {
        if (other.name === name) continue
        const clash = servedHosts(other, appsDomain).find((host) => wanted.includes(host))
        if (clash) return reply.code(409).send({ error: `${clash} is used by ${other.name}` })
      }
      // Left out, `takeOver` keeps its current value too (ADR 0022).
      const takeOver = request.body.takeOver ?? current?.takeOver ?? false
      // And `analytics` (ADR 0038): on unless the app turned it off.
      const analytics = request.body.analytics ?? current?.analytics ?? true
      return apps.deploy({
        name,
        ...request.body,
        database,
        protected: protect,
        takeOver,
        analytics,
      })
    },
  )

  app.delete<{ Params: NameParams; Querystring: { purge: boolean } }>(
    '/apps/:name',
    {
      schema: {
        params: nameParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { purge: { type: 'boolean', default: false } },
        },
      },
    },
    async (request, reply) => {
      const removed = await apps.remove(request.params.name, { purge: request.query.purge })
      return removed ? reply.code(204).send() : reply.code(404).send({ error: 'No such app' })
    },
  )

  // Where the app's custom domain stands, and which records its owner still has to create.
  app.get<{ Params: NameParams }>(
    '/apps/:name/domain',
    { schema: { params: nameParamsSchema } },
    async (request, reply) => {
      const status = await apps.domainStatus(request.params.name)
      return status ?? reply.code(404).send({ error: 'No such app' })
    },
  )

  // The user pool's users (ADR 0035), read and deleted in the instance database's `auth`.
  app.get<{ Querystring: { limit: number; cursor?: string; app?: string } }>(
    '/pool/users',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            cursor: { type: 'string', maxLength: 200, pattern: '^[A-Za-z0-9_-]+$' },
            // One app's users: those with a session on its hosts (ADR 0040).
            app: { type: 'string', pattern: NAME },
          },
        },
      },
    },
    async (request) => apps.listUsers(request.query),
  )

  // The whole pool's account counts, as an app's usage counts its own (ADR 0040).
  app.get('/pool/usage', async () => apps.poolUsage())

  app.delete<{ Params: { id: string } }>(
    '/pool/users/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: UUID } },
        },
      },
    },
    async (request, reply) => {
      const deleted = await apps.deleteUser(request.params.id)
      return deleted ? reply.code(204).send() : reply.code(404).send({ error: 'No such user' })
    },
  )

  // Backups (ADR 0030): every app's last one, one app's, and a backup now.
  app.get('/backups', async () => {
    const result: Record<string, unknown> = {}
    for (const { name } of await apps.list()) result[name] = (await apps.backupStatus(name)) ?? null
    return { enabled: Boolean(apps.settings.backups), apps: result }
  })

  app.get<{ Params: NameParams }>(
    '/apps/:name/backup',
    { schema: { params: nameParamsSchema } },
    async (request, reply) => {
      if (!(await apps.get(request.params.name)))
        return reply.code(404).send({ error: 'No such app' })
      return (await apps.backupStatus(request.params.name)) ?? null
    },
  )

  app.post<{ Params: NameParams }>(
    '/apps/:name/backup',
    { schema: { params: nameParamsSchema } },
    async (request) => apps.backup(request.params.name),
  )

  // The app's backups in the bucket, and putting its schema back from one (ADR 0043).
  app.get<{ Params: NameParams }>(
    '/apps/:name/backups',
    { schema: { params: nameParamsSchema } },
    async (request) => ({ backups: await apps.listBackups(request.params.name) }),
  )

  app.post<{ Params: NameParams; Body: { key: string } }>(
    '/apps/:name/restore',
    {
      schema: {
        params: nameParamsSchema,
        body: {
          type: 'object',
          required: ['key'],
          additionalProperties: false,
          properties: { key: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (request) => apps.restore(request.params.name, request.body.key),
  )

  // The app's usage (ADR 0038): visits from Umami and accounts from the pool, counts only.
  app.get<{ Params: NameParams; Querystring: { days: number; brief: boolean } }>(
    '/apps/:name/usage',
    {
      schema: {
        params: nameParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            days: { type: 'integer', minimum: 1, maximum: 90, default: 7 },
            // Totals only, for the app list: no breakdowns.
            brief: { type: 'boolean', default: false },
          },
        },
      },
    },
    (request) => apps.usage(request.params.name, request.query.days, request.query.brief),
  )

  // Where the app's tables are, and moving an app made before ADR 0034 into its schema.
  app.get<{ Params: NameParams }>(
    '/apps/:name/database',
    { schema: { params: nameParamsSchema } },
    async (request) => ({ layout: await apps.databaseLayout(request.params.name) }),
  )

  app.post<{ Params: NameParams; Body: { tag: string } }>(
    '/apps/:name/move',
    {
      schema: {
        params: nameParamsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['tag'],
          properties: { tag: { type: 'string', pattern: TAG } },
        },
      },
    },
    async (request) => apps.move(request.params.name, request.body.tag),
  )

  // The app's deploy hook (ADR 0029). The dashboard manages its token: a new one is returned
  // once, and only its hash is kept.
  app.get<{ Params: NameParams }>(
    '/apps/:name/hook-token',
    { schema: { params: nameParamsSchema } },
    async (request, reply) => {
      const enabled = await apps.hasHookToken(request.params.name)
      return enabled === undefined ? reply.code(404).send({ error: 'No such app' }) : { enabled }
    },
  )

  app.post<{ Params: NameParams }>(
    '/apps/:name/hook-token',
    { schema: { params: nameParamsSchema } },
    async (request, reply) =>
      reply.code(201).send({ token: await apps.createHookToken(request.params.name) }),
  )

  app.delete<{ Params: NameParams }>(
    '/apps/:name/hook-token',
    { schema: { params: nameParamsSchema } },
    async (request, reply) => {
      await apps.deleteHookToken(request.params.name)
      return reply.code(204).send()
    },
  )

  // A release from the app's CI, relayed by the dashboard: the hook token comes in
  // X-Hook-Token, next to the dashboard's own token. Only the tag can change. A missing token
  // gets the same 401 as a wrong one.
  const hookToken = (headers: Record<string, string | string[] | undefined>) => {
    const value = headers['x-hook-token']
    if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
      throw new AgentError('Unauthorized', 401)
    }
    return value
  }

  app.post<{ Params: NameParams; Body: { tag: string } }>(
    '/apps/:name/release',
    {
      // The token is checked before the body, so a caller without one learns nothing more.
      preValidation: async (request) => {
        hookToken(request.headers)
      },
      schema: {
        params: nameParamsSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['tag'],
          properties: { tag: { type: 'string', pattern: TAG } },
        },
      },
    },
    async (request, reply) => {
      const { name } = request.params
      const state = await apps.release(name, hookToken(request.headers), request.body.tag)
      return reply.code(202).send(state)
    },
  )

  app.get<{ Params: NameParams }>(
    '/apps/:name/release',
    { schema: { params: nameParamsSchema } },
    async (request) => apps.releaseState(request.params.name, hookToken(request.headers)),
  )

  app.get<{ Params: NameParams; Querystring: { tail: number } }>(
    '/apps/:name/logs',
    {
      schema: {
        params: nameParamsSchema,
        querystring: {
          type: 'object',
          properties: { tail: { type: 'integer', minimum: 1, maximum: 5000, default: 200 } },
        },
      },
    },
    async (request, reply) => {
      const logs = await apps.logs(request.params.name, request.query.tail)
      if (logs === undefined) return reply.code(404).send({ error: 'No such app' })
      return reply.type('text/plain; charset=utf-8').send(logs)
    },
  )

  return app
}
