import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { AccessApps } from './access.ts'
import type { Analytics } from './analytics.ts'
import {
  type AgentSettings,
  type AppSpec,
  customHosts,
  type DomainStatus,
  defaultHost,
  hostnames,
  POOL_PATH,
  projectName,
  publicUrl,
  servedHosts,
  slotService,
} from './app-spec.ts'
import { type BackupStatus, type BackupTarget, backupStamp, type Dump } from './backups.ts'
import { CloudflareError } from './cloudflare.ts'
import { DomainConflict, type Domains } from './domains.ts'
import type { Runner, RunResult } from './runner.ts'
import type { AppFiles, Store } from './store.ts'
import {
  composeService,
  renderCompose,
  renderPoolSite,
  renderSite,
  upstreamAlias,
} from './templates.ts'

/** The image label naming the command that migrates the app before it starts (ADR 0034). */
export const MIGRATE_LABEL = 'dev.spotcraft.migrate'

/** How long migrations may run, and how long an app without a HEALTHCHECK has to answer. */
const MIGRATE_SECONDS = 300
const PROBE_SECONDS = 120

/** The user pool's site file, `sites/_auth.caddy`; app names can't start with `_`. */
const POOL_SITE = '_auth'

/**
 * What the agent needs from an image: the migrate command from its label, and whether it has
 * a HEALTHCHECK. Unknown (an inspect that failed) counts as having one, as before.
 */
export function readImageConfig(inspected: string): { migrate?: string[]; healthcheck: boolean } {
  let config: { Labels?: Record<string, string> | null; Healthcheck?: { Test?: string[] } | null }
  try {
    config = JSON.parse(inspected)
  } catch {
    return { healthcheck: true }
  }
  const test = config?.Healthcheck?.Test
  const healthcheck = Boolean(test && test.length > 0 && test[0] !== 'NONE')
  const label = config?.Labels?.[MIGRATE_LABEL]
  if (label === undefined) return { healthcheck }
  let migrate: unknown
  try {
    migrate = JSON.parse(label)
  } catch {
    throw new AgentError(`The image's ${MIGRATE_LABEL} label isn't JSON`, 400)
  }
  if (
    !Array.isArray(migrate) ||
    migrate.length === 0 ||
    migrate.length > 32 ||
    !migrate.every((part) => typeof part === 'string' && part.length > 0 && part.length <= 1024)
  ) {
    throw new AgentError(
      `The image's ${MIGRATE_LABEL} label must be a JSON array of the command and its arguments`,
      400,
    )
  }
  return { migrate: migrate as string[], healthcheck }
}

/** Where the user pool's backups go in the bucket, and its key in `backupAll`'s result. */
export const POOL_BACKUP = '_auth'

/**
 * The health probe, run with Node in Caddy's container: exits 0 on a 2xx, or a 404 (the app
 * answers on its port, without that route); 1 otherwise, saying what it got.
 */
export const PROBE_SCRIPT = `fetch(process.argv[1], { signal: AbortSignal.timeout(3000) }).then(
  (r) => { if (r.ok || r.status === 404) process.exit(0); console.error('HTTP ' + r.status); process.exit(1) },
  (e) => { console.error(String(e.cause ?? e)); process.exit(1) },
)`
/** Analytics' database in the bucket (ADR 0038), beside the apps and the pool. */
export const ANALYTICS_BACKUP = '_umami'

/**
 * A database the platform runs for itself, backed up nightly after the apps, as
 * `<folder>/<time>/<file>`. Folders start with `_`, which app names can't.
 */
export interface PlatformDump {
  folder: string
  file: string
  dump: () => Promise<Buffer>
}

export type { BackupStatus }

export class AgentError extends Error {
  readonly statusCode: number
  readonly output: string
  constructor(message: string, statusCode: number, output = '') {
    super(message)
    this.statusCode = statusCode
    this.output = output
  }
}

export interface AppStatus extends AppSpec {
  /** Container state from Docker: running, exited, restarting… or "missing". */
  state: string
  /** healthy, unhealthy, starting, or "" when the image has no healthcheck. */
  health: string
  /** Docker's human-readable status, e.g. "Up 3 hours (healthy)". */
  status: string
  /** Every host the app answers on, its default host first (ADR 0021). */
  hostnames: string[]
}

/** The fields of `docker ps --format json` the agent reads. */
interface ContainerRow {
  ID?: string
  Labels?: string
  State?: string
  Status?: string
}

const label = (row: ContainerRow, key: string) =>
  new RegExp(`(?:^|,)${key.replaceAll('.', '\\.')}=([^,]+)`).exec(row.Labels ?? '')?.[1]

/** The live slot's container, out of an app's containers (both slots run during a deploy). */
const liveRow = (rows: ContainerRow[] | undefined, service: string | undefined) =>
  rows?.find((row) => label(row, 'com.docker.compose.service') === service) ?? rows?.[0]

function withStatus(
  spec: AppSpec,
  row: ContainerRow | undefined,
  settings: AgentSettings,
): AppStatus {
  const status = row?.Status ?? ''
  // `docker ps` has no health field; Docker writes it into the status text.
  const health = /\((healthy|unhealthy|health: starting)\)/.exec(status)?.[1]
  return {
    ...spec,
    state: row?.State ?? 'missing',
    health: health === 'health: starting' ? 'starting' : (health ?? ''),
    status,
    hostnames: hostnames(spec, settings.appsDomain),
  }
}

/**
 * App databases on the server's Postgres (ADR 0015). Kept behind this interface so
 * this module (which the dashboard imports for its types) doesn't load the database code.
 */
export interface Databases {
  /**
   * Creates or updates the app's role and schema (or its own database, from before ADR 0034);
   * returns the env that tells the app where it is: DATABASE_URL, and DATABASE_SCHEMA for a
   * schema.
   */
  provision(
    name: string,
    password: string,
    options?: { move?: boolean },
  ): Promise<Record<string, string>>
  /** Drops the app's schema or database, and its role, if they exist. */
  purge(name: string): Promise<void>
  /** Where the app's tables are: its schema, its own database (before ADR 0034), or nowhere. */
  layout(name: string): Promise<'schema' | 'database' | 'none'>
  /**
   * Copies an app from its own database into its schema, in one transaction: its kit guests
   * and live sessions into the pool (same ids and tokens), `formerSecret` (its old
   * AUTH_SECRET, which signed their cookies) for the pool to accept, and the rows of each
   * table of `public` that the new version made in the schema and left empty.
   */
  move(name: string, options: { formerSecret?: string }): Promise<Moved>
  /** Drops the app's schema only, after a move that failed. */
  dropSchema(name: string): Promise<void>
  /** A page of the user pool's users (ADR 0035), newest first. */
  listUsers(page: { limit: number; cursor?: string }): Promise<UserPage>
  /**
   * Deletes a user from the pool; their sessions and every app's rows for them go with them.
   * False if not found.
   */
  deleteUser(id: string): Promise<boolean>
}

/** What a move copied: guests, sessions, and rows per table. */
export interface Moved {
  users: number
  sessions: number
  tables: Record<string, number>
}

/** A user of the pool, as the dashboard shows it. */
export interface PoolUser {
  id: string
  /** A guest (no sign-up) rather than a registered user. */
  guest: boolean
  createdAt: string
  /** When a session of theirs was last used; null if they have none left. */
  lastSeen: string | null
}

export interface UserPage {
  /** False until the user pool has set up its schema and given the agent access. */
  available: boolean
  total: number
  /** How many of them are guests. */
  guests: number
  users: PoolUser[]
  /** Pass back as `cursor` for the next (older) page; absent on the last page. */
  next?: string
}

/** Where an app's last release through its deploy hook stands (ADR 0029). */
export interface ReleaseState {
  state: 'deploying' | 'live' | 'failed'
  tag: string
  /** When it was asked for (ISO); absent when the agent has no record since it started. */
  at?: string
  /** Why it failed: the agent's message, without command output. */
  error?: string
}

/** A hook release waiting in the queue, and the token it came with. */
interface PendingRelease {
  id: number
  tag: string
  tokenHash: string
  /** Set when a newer release or a token change replaced it: it does nothing when its turn comes. */
  cancelled: boolean
}

const sha256 = (value: string) => createHash('sha256').update(value).digest()

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const tail = (result: RunResult) => `${result.stdout}\n${result.stderr}`.trim().slice(-4000)

/** Deploys and removes apps. One change at a time; reads run freely. */
export class Apps {
  readonly #store: Store
  readonly #run: Runner
  readonly #caddyContainer: string
  /** Whether apps get a schema: the server has Postgres (ADR 0034). */
  get hasDatabases(): boolean {
    return Boolean(this.#databases)
  }

  /** How an image without a HEALTHCHECK is waited for; tests shorten it. */
  probe = { intervalMs: 2000, seconds: PROBE_SECONDS }
  /**
   * The instance's analytics (ADR 0038). With it, every app gets an Umami website, whose id its
   * site carries; without it, sites count nothing. Never a reason for a deploy to fail.
   */
  analytics: Analytics | undefined
  readonly #databases: Databases | undefined
  readonly settings: AgentSettings
  readonly #domains: Domains | undefined
  readonly #access: AccessApps | undefined
  readonly #backups:
    | { target: BackupTarget; dump: Dump; platform: PlatformDump[]; now: () => Date }
    | undefined
  /** Apps with a backup on request waiting or running. */
  readonly #backingUp = new Set<string>()
  #queue: Promise<unknown> = Promise.resolve()
  /** The last release through each app's deploy hook, with a number to tell releases apart. */
  readonly #releases = new Map<string, ReleaseState & { id: number }>()
  /** Per app, the hook release waiting in the queue, if any, and the token it came with. */
  readonly #waitingReleases = new Map<string, PendingRelease>()
  #releaseCount = 0
  /** Read-modify-writes of `secrets.json`, one at a time (`#withSecrets`). */
  #secretsQueue: Promise<unknown> = Promise.resolve()
  /** Whether startup recovery has finished, so stored tags are what serves (`recover`). */
  #recovered = false

  /** Without `databases`, apps can't ask for a database (the server has no Postgres). */
  constructor(
    store: Store,
    run: Runner,
    caddyContainer: string,
    databases?: Databases,
    settings: AgentSettings = { edge: 'direct' },
    /**
     * With it, custom domains' DNS is set up through the Cloudflare API and, with `access`,
     * protected apps are put behind Cloudflare Access (ADR 0021).
     */
    cloudflare?: { domains: Domains; access?: AccessApps },
    /**
     * With it, apps are backed up to a bucket (ADR 0030): `backupAll`, nightly. `platform`
     * lists the platform's own databases, backed up after the apps: the user pool's `auth`
     * schema (ADR 0035) and analytics' database (ADR 0038).
     */
    backups?: {
      target: BackupTarget
      dump: Dump
      platform?: PlatformDump[]
      now?: () => Date
    },
  ) {
    this.#store = store
    this.#run = run
    this.#caddyContainer = caddyContainer
    this.#databases = databases
    this.settings = {
      ...settings,
      dns: Boolean(cloudflare?.domains),
      access: Boolean(cloudflare?.access),
      backups: Boolean(backups),
    }
    this.#backups = backups && { now: () => new Date(), platform: [], ...backups }
    this.#domains = cloudflare?.domains
    this.#access = cloudflare?.access
  }

  /** Runs a Cloudflare step; its failures become clear agent errors. */
  async #cloudflare<T>(what: string, step: () => Promise<T>): Promise<T> {
    try {
      return await step()
    } catch (error) {
      if (error instanceof DomainConflict) throw new AgentError(error.message, 409)
      const detail = error instanceof CloudflareError ? error.message : message(error)
      throw new AgentError(`Could not ${what}`, 502, detail)
    }
  }

  #exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(task, task)
    this.#queue = next.catch(() => {})
    return next
  }

  /** Runs Compose on the app's live compose file, or with `staged` on a deploy's new one. */
  #compose(name: string, args: string[], { staged = false } = {}) {
    const file = staged ? this.#store.stagedComposePath(name) : this.#store.composePath(name)
    return this.#run('docker', ['compose', '-p', projectName(name), '-f', file, ...args])
  }

  async #reloadCaddy() {
    return this.#run('docker', [
      'exec',
      this.#caddyContainer,
      'caddy',
      'reload',
      '--config',
      '/etc/caddy/Caddyfile',
      '--adapter',
      'caddyfile',
    ])
  }

  async list(): Promise<AppStatus[]> {
    const specs = await this.#store.list()
    if (specs.length === 0) return []
    const containers = await this.#containers()
    return Promise.all(
      specs.map(async (spec) =>
        withStatus(
          spec,
          liveRow(containers.get(projectName(spec.name)), await this.#liveService(spec.name)),
          this.settings,
        ),
      ),
    )
  }

  async get(name: string): Promise<AppStatus | undefined> {
    const spec = await this.#store.get(name)
    if (!spec) return undefined
    return this.#status(spec)
  }

  async #status(spec: AppSpec): Promise<AppStatus> {
    const project = projectName(spec.name)
    const rows = (await this.#containers(project)).get(project)
    return withStatus(spec, liveRow(rows, await this.#liveService(spec.name)), this.settings)
  }

  /** The service of the app's live slot, from its compose file; undefined if it has none. */
  async #liveService(name: string): Promise<string | undefined> {
    const files = await this.#store.read(name)
    return files ? composeService(files.compose) : undefined
  }

  /**
   * Every app container's state from a single `docker ps` (one process, however many apps),
   * grouped by Compose project. With `project`, only that app's containers.
   */
  async #containers(project?: string): Promise<Map<string, ContainerRow[]>> {
    const filter = project
      ? `label=com.docker.compose.project=${project}`
      : 'label=com.docker.compose.project'
    const result = await this.#run('docker', [
      'ps',
      '--all',
      '--filter',
      filter,
      '--format',
      'json',
    ])
    const rows = new Map<string, ContainerRow[]>()
    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue
      const row = JSON.parse(line) as ContainerRow
      const name = label(row, 'com.docker.compose.project')
      if (name?.startsWith('spotcraft-app-')) rows.set(name, [...(rows.get(name) ?? []), row])
    }
    return rows
  }

  /** Stops and removes the app's containers other than `keep`'s: the slot traffic left. */
  async #removeOtherSlots(name: string, keep: string | undefined) {
    const rows = (await this.#containers(projectName(name))).get(projectName(name)) ?? []
    const ids = rows
      .filter((row) => label(row, 'com.docker.compose.service') !== keep)
      .map((row) => row.ID)
      .filter((id): id is string => Boolean(id))
    if (ids.length === 0) return
    // SIGTERM, then up to 30 seconds to finish the requests it already has (as its compose
    // file's stop_grace_period). A failure leaves it running, which costs memory, not traffic.
    const stop = await this.#run('docker', ['stop', '--time', '30', ...ids], 60_000)
    const rm = stop.code === 0 ? await this.#run('docker', ['rm', ...ids]) : stop
    if (rm.code !== 0) console.warn(`could not remove the old slot of ${name}: ${tail(rm)}`)
  }

  /**
   * Writes the app's files and rolls it out; on failure, puts the previous version back.
   * With `spec.takeOver`, a custom domain's existing DNS records are replaced (ADR 0022).
   */
  deploy(spec: AppSpec): Promise<AppStatus> {
    return this.#exclusive(async () => {
      const status = await this.#deploy(spec)
      // The dashboard deployed (maybe another tag): a finished hook release no longer says
      // what runs. One still waiting or running keeps its record.
      if (this.#releases.get(spec.name)?.state !== 'deploying') this.#releases.delete(spec.name)
      return status
    })
  }

  /**
   * With `takeOver: false`, this deploy replaces no foreign DNS records whatever the app's
   * setting, which stays as stored (a hook release, ADR 0029).
   */
  async #deploy(
    spec: AppSpec,
    {
      takeOver = Boolean(spec.takeOver),
      move,
    }: { takeOver?: boolean; move?: () => Promise<void> } = {},
  ): Promise<AppStatus> {
    const previousSpec = await this.#store.get(spec.name)
    const oldHosts = previousSpec ? customHosts(previousSpec) : []
    const newHosts = customHosts(spec)
    // DNS first, then the database: if either can't be prepared, the app hasn't changed yet.
    const domains = this.#domains
    const undoDns = domains
      ? await this.#cloudflare(`set up DNS for ${spec.domain}`, () =>
          domains.attach(spec.name, newHosts, { takeOver }),
        )
      : undefined
    const access = this.#access
    let status: AppStatus
    try {
      // Protection goes on before the new version takes traffic.
      if (access) {
        await this.#cloudflare('set up Cloudflare Access', () =>
          access.sync(
            spec.name,
            servedHosts(spec, this.settings.appsDomain),
            Boolean(spec.protected),
          ),
        )
      }
      status = await this.#rollOut(spec, move)
    } catch (error) {
      // Put DNS back exactly as it was (records a take-over replaced included), and the
      // previous protection (best effort).
      await undoDns?.()
      await access
        ?.sync(
          spec.name,
          previousSpec ? servedHosts(previousSpec, this.settings.appsDomain) : [],
          Boolean(previousSpec?.protected),
        )
        .catch(() => {})
      throw error
    }
    // A domain the app no longer has: its records go, now that the new version runs.
    const dropped = oldHosts.filter((host) => !newHosts.includes(host))
    await this.#domains?.detach(spec.name, dropped).catch((error) => {
      console.warn(`could not remove DNS records for ${dropped.join(', ')}: ${message(error)}`)
    })
    return status
  }

  /**
   * Forgets the app's hook releases: the one waiting in the queue is cancelled, and their state
   * isn't shown to whoever holds the next token. Done at once, not in the queue, so a release
   * that is waiting can't run before the token change.
   */
  #forgetReleases(name: string) {
    const waiting = this.#waitingReleases.get(name)
    if (waiting) waiting.cancelled = true
    this.#waitingReleases.delete(name)
    this.#releases.delete(name)
  }

  /**
   * Runs a read-modify-write of `secrets.json` one at a time. Not in the deploy queue, so token
   * changes answer at once even while deploys run.
   */
  #withSecrets<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#secretsQueue.then(task, task)
    this.#secretsQueue = next.catch(() => {})
    return next
  }

  /** Makes a new deploy hook token for the app, replacing any old one; returns it, once. */
  createHookToken(name: string): Promise<string> {
    return this.#withSecrets(async () => {
      if (!(await this.#store.get(name))) throw new AgentError('No such app', 404)
      this.#forgetReleases(name)
      const token = randomBytes(32).toString('base64url')
      const secrets = await this.#store.readSecrets(name)
      await this.#store.writeSecrets(name, {
        ...secrets,
        hookTokenHash: sha256(token).toString('hex'),
      })
      return token
    })
  }

  /** Turns the app's deploy hook off. */
  deleteHookToken(name: string): Promise<void> {
    return this.#withSecrets(async () => {
      if (!(await this.#store.get(name))) throw new AgentError('No such app', 404)
      this.#forgetReleases(name)
      const { hookTokenHash: _, ...secrets } = await this.#store.readSecrets(name)
      await this.#store.writeSecrets(name, secrets)
    })
  }

  /** Whether the app has a deploy hook token; undefined if there is no such app. */
  async hasHookToken(name: string): Promise<boolean | undefined> {
    if (!(await this.#store.get(name))) return undefined
    return Boolean((await this.#store.readSecrets(name)).hookTokenHash)
  }

  /**
   * Whether `token` is the app's deploy hook token. False for an app without one, or with no
   * such app, so a caller can't tell which. Compared as digests, in constant time.
   */
  async #hookAllows(name: string, token: string): Promise<boolean> {
    const { hookTokenHash } = await this.#store.readSecrets(name)
    if (!hookTokenHash) return false
    return timingSafeEqual(Buffer.from(hookTokenHash, 'hex'), sha256(token))
  }

  /**
   * A release through the deploy hook: the app's stored spec with only `tag` changed, so the
   * image, env and limits stay as the dashboard set them, and DNS records are never taken
   * over. Answers at once; the deploy runs in the queue, and `releaseState` says how it went.
   *
   * At most one release per app waits to deploy: a newer one cancels it and takes its own
   * place at the back of the queue, so it also comes after any edit queued in between. A
   * cancelled release is a no-op when its turn comes, so a CI loop or a leaked token can't pile
   * up deploys in front of everything else. When it runs, the token it came with must still be
   * the app's; turning the hook off or making a new token cancels a waiting release at once.
   */
  async release(name: string, token: string, tag: string): Promise<ReleaseState> {
    if (!(await this.#hookAllows(name, token))) throw new AgentError('Unauthorized', 401)
    const pending: PendingRelease = {
      id: ++this.#releaseCount,
      tag,
      tokenHash: sha256(token).toString('hex'),
      cancelled: false,
    }
    const replaced = this.#waitingReleases.get(name)
    if (replaced) replaced.cancelled = true
    this.#waitingReleases.set(name, pending)
    const started: ReleaseState = { state: 'deploying', tag, at: new Date().toISOString() }
    this.#releases.set(name, { ...started, id: pending.id })
    const settle = (result: Partial<ReleaseState>) => {
      // A newer release since: its state is the one to keep.
      const current = this.#releases.get(name)
      if (current?.id === pending.id) this.#releases.set(name, { ...current, ...result })
    }
    this.#exclusive(async () => {
      if (pending.cancelled) return false
      if (this.#waitingReleases.get(name) === pending) this.#waitingReleases.delete(name)
      const { hookTokenHash } = await this.#store.readSecrets(name)
      if (hookTokenHash !== pending.tokenHash) {
        throw new AgentError('The deploy hook token changed before this release ran', 401)
      }
      const spec = await this.#store.get(name)
      if (!spec) throw new AgentError(`${name} was removed`, 404)
      await this.#deploy({ ...spec, tag }, { takeOver: false })
      return true
    }).then(
      (ran) => ran && settle({ state: 'live' }),
      (error: unknown) => {
        // No one is waiting on this request: the command output goes to the agent's log.
        const output = error instanceof AgentError ? error.output : ''
        console.warn(
          `release of ${name}:${tag} through its deploy hook failed: ${message(error)}\n${output}`,
        )
        settle({ state: 'failed', error: message(error) })
      },
    )
    return started
  }

  /**
   * How the app's last hook release went. Without one since the agent started (or since the
   * dashboard last deployed), the tag that runs, once startup recovery has made sure of it.
   */
  async releaseState(name: string, token: string): Promise<ReleaseState> {
    if (!(await this.#hookAllows(name, token))) throw new AgentError('Unauthorized', 401)
    const release = this.#releases.get(name)
    if (release) {
      const { id: _, ...state } = release
      return state
    }
    // Until `recover` has run, the stored tag may not be the one Caddy routes to.
    if (!this.#recovered) throw new AgentError('Spotcraft is starting; try again', 503)
    const spec = await this.#store.get(name)
    if (!spec) throw new AgentError('Unauthorized', 401)
    return { state: 'live', tag: spec.tag }
  }

  /**
   * Starts the new version in the slot that isn't live, next to the live one; once it is
   * healthy, Caddy moves traffic to it and the old slot stops (ADR 0028). Until then the live
   * slot serves as before, so a version that fails never gets traffic.
   *
   * The new spec and compose file are staged next to the live ones and only committed once the
   * new slot is healthy, so an agent that stops mid-deploy restarts with the live slot's files
   * (`recover`).
   */
  async #rollOut(requested: AppSpec, move?: () => Promise<void>): Promise<AppStatus> {
    // Every app has a schema on a server with Postgres, including one released by its hook
    // from a spec stored before ADR 0034.
    const spec = { ...requested, database: this.hasDatabases }
    const env = await this.#platformEnv(spec, { move: Boolean(move) })
    const previous = await this.#store.read(spec.name)
    const live = previous ? composeService(previous.compose) : undefined
    const slot = live === slotService(spec.name, 'blue') ? 'green' : 'blue'
    const service = slotService(spec.name, slot)
    await this.#store.stage(spec.name, {
      spec: `${JSON.stringify(spec, null, 2)}\n`,
      compose: renderCompose(spec, service, env),
    })

    const pull = await this.#compose(spec.name, ['pull', '--quiet'], { staged: true })
    if (pull.code !== 0) {
      await this.#abandon(spec.name, service, previous)
      throw new AgentError(`Could not pull ${spec.image}:${spec.tag}`, 502, tail(pull))
    }
    let image: { migrate?: string[]; healthcheck: boolean }
    try {
      const inspected = await this.#run('docker', [
        'image',
        'inspect',
        '--format',
        '{{json .Config}}',
        `${spec.image}:${spec.tag}`,
      ])
      image = readImageConfig(inspected.code === 0 ? inspected.stdout : '')
    } catch (error) {
      await this.#abandon(spec.name, service, previous)
      throw error
    }
    // A migrate label means a version made for the schema and the pool (ADR 0034). On an app
    // that still has its own database it would migrate that database and start against it,
    // with guests the database doesn't know; only a move may deploy it.
    if (image.migrate && !move && (await this.#databases?.layout(spec.name)) === 'database') {
      await this.#abandon(spec.name, service, previous)
      throw new AgentError(
        `${spec.name} still has its own database, and ${spec.image}:${spec.tag} is made for its schema: move it first`,
        409,
      )
    }
    // Migrations first, in a container of the new image, while the live slot still serves
    // (they only add, ADR 0028). If they fail, nothing has changed for visitors.
    if (image.migrate) {
      const migrated = await this.#migrate(spec, service, image.migrate)
      if (migrated.code !== 0) {
        await this.#abandon(spec.name, service, previous)
        throw new AgentError(`The migrations of ${spec.name} failed`, 502, tail(migrated))
      }
    }
    // A move fills the new schema now that it has its tables, while the old version still
    // serves (what it writes from here on stays behind).
    if (move) {
      try {
        await move()
      } catch (error) {
        await this.#abandon(spec.name, service, previous)
        throw error
      }
    }
    // Only the new slot's service, and no --remove-orphans: the live slot's container isn't in
    // this compose file, and must keep running.
    const up = await this.#compose(
      spec.name,
      ['up', '-d', '--wait', '--wait-timeout', '120', service],
      {
        staged: true,
      },
    )
    // An image without a HEALTHCHECK is only "running" now: wait until it answers.
    const ready = up.code === 0 && !image.healthcheck ? await this.#probe(spec, service) : up
    if (ready.code !== 0) {
      const logs = await this.#compose(spec.name, ['logs', '--tail', '50', '--no-color'], {
        staged: true,
      })
      await this.#abandon(spec.name, service, previous)
      throw new AgentError(
        `${spec.name} did not start or become healthy`,
        502,
        `${tail(ready)}\n${tail(logs)}`,
      )
    }
    // The new slot is healthy: point the site at it, then commit. A restart before the commit
    // finds the old compose file, rewrites the site back and drops the new slot.
    const websiteId = await this.#ensureWebsite(spec)
    await this.#store.writeSite(spec.name, renderSite(spec, this.settings, service, websiteId))
    await this.#store.commit(spec.name)
    const reload = await this.#reloadCaddy()
    if (reload.code !== 0) {
      // Caddy still runs its previous configuration, so the old slot still serves.
      await this.#compose(spec.name, ['rm', '--stop', '--force', service])
      if (previous) await this.#store.write(spec.name, previous)
      else await this.#store.remove(spec.name)
      await this.#reloadCaddy()
      throw new AgentError('Caddy rejected the site configuration', 500, tail(reload))
    }
    // Traffic is on the new slot: the old one (or the single service of an app deployed before
    // slots) can go.
    await this.#removeOtherSlots(spec.name, service)
    return this.#status(spec)
  }

  /**
   * Gives up a deploy before its commit: removes the new slot's container and the staged files.
   * The live slot, its files and Caddy were never touched. An app that had no previous version
   * is removed altogether.
   */
  async #abandon(name: string, service: string, previous: AppFiles | undefined) {
    // A pull failure started nothing; `rm` then has nothing to do.
    await this.#compose(name, ['rm', '--stop', '--force', service], { staged: true })
    if (previous) await this.#store.discardStaged(name)
    else await this.#store.remove(name)
  }

  /** Where the app's custom domain stands; undefined if there is no such app. */
  async domainStatus(name: string): Promise<DomainStatus | undefined> {
    const spec = await this.#store.get(name)
    if (!spec) return undefined
    const { appsDomain, edge } = this.settings
    const target = appsDomain ? defaultHost(name, appsDomain) : undefined
    const hosts = customHosts(spec)
    if (this.#domains && target) {
      return { target, hosts: await this.#domains.status(name, hosts, target) }
    }
    // Spotcraft doesn't manage DNS: say what to create by hand.
    return {
      target,
      hosts: hosts.map((host) => ({
        host,
        mode: 'manual',
        state: 'unknown',
        records: [
          target && edge === 'cloudflare'
            ? { type: 'CNAME', name: host, value: target }
            : { type: 'A/AAAA', name: host, value: 'the server' },
        ],
      })),
    }
  }

  /**
   * Rewrites every app's Caddy site for the current settings and reloads Caddy if any
   * changed. Sites depend on EDGE and APPS_DOMAIN, so after either changes (a redeploy of
   * Spotcraft), every app must follow, not only the next one deployed. Returns the apps whose
   * site changed.
   */
  refreshSites(): Promise<string[]> {
    return this.#exclusive(() => this.#refreshSites())
  }

  /**
   * What the agent does when it starts, before anything else (ADR 0028):
   * 1. locks down every app directory's env- and password-bearing files, as older agents left
   *    them readable by everyone, including directories that aren't a complete app;
   * 2. drops what a deploy interrupted before its commit had staged, and finishes a commit
   *    interrupted between its renames;
   * 3. rewrites the sites for the live slots and the current settings (`refreshSites`);
   * 4. removes containers of slots that aren't live: the new slot of an interrupted deploy, or
   *    the old one of a deploy that stopped before removing it. Caddy reloads first, so it no
   *    longer routes to them.
   * Throws if Caddy can't reload yet (it may still be starting); it is safe to call again.
   */
  recover(): Promise<string[]> {
    return this.#exclusive(async () => {
      for (const name of await this.#store.names()) {
        await this.#store.lockDown(name)
        if (await this.#store.recover(name)) await this.#store.discardStaged(name)
      }
      const changed = await this.#refreshSites()
      const strays: { name: string; live: string | undefined }[] = []
      const containers = await this.#containers()
      for (const name of await this.#store.names()) {
        const live = await this.#liveService(name)
        const rows = containers.get(projectName(name)) ?? []
        if (rows.some((row) => label(row, 'com.docker.compose.service') !== live)) {
          strays.push({ name, live })
        }
      }
      if (strays.length > 0) {
        // The previous agent may have committed a slot without reloading Caddy.
        const reload = await this.#reloadCaddy()
        if (reload.code !== 0) throw new AgentError('Caddy could not reload', 500, tail(reload))
        for (const { name, live } of strays) await this.#removeOtherSlots(name, live)
      }
      this.#recovered = true
      return changed
    })
  }

  /**
   * The id of the app's Umami website, made the first time and kept in `secrets.json`. If Umami
   * can't be reached, the id kept so far (or none): the deploy goes on, and the site counts
   * again once a later deploy or `backfillAnalytics` reaches Umami.
   */
  async #ensureWebsite(spec: AppSpec): Promise<string | undefined> {
    const { analyticsId } = await this.#store.readSecrets(spec.name)
    if (!this.analytics) return analyticsId
    const [host] = hostnames(spec, this.settings.appsDomain)
    try {
      const id = await this.analytics.ensureWebsite(spec.name, host ?? spec.name, analyticsId)
      if (id !== analyticsId) {
        await this.#withSecrets(async () => {
          const secrets = await this.#store.readSecrets(spec.name)
          await this.#store.writeSecrets(spec.name, { ...secrets, analyticsId: id })
        })
      }
      return id
    } catch (error) {
      console.warn(`analytics for ${spec.name}: ${message(error)}`)
      return analyticsId
    }
  }

  /**
   * Gives every app without one an Umami website, then refreshes the sites, so apps made before
   * analytics (or while Umami was down) start counting. Run after `recover`; Umami may still be
   * starting, so it tries again every `retryMs` for up to `attempts` times. Returns the apps
   * that got a website.
   */
  async backfillAnalytics({ attempts = 20, retryMs = 15_000 } = {}): Promise<string[]> {
    const analytics = this.analytics
    if (!analytics) return []
    for (let attempt = 1; ; attempt++) {
      const missing: AppSpec[] = []
      for (const spec of await this.#store.list()) {
        if (!(await this.#store.readSecrets(spec.name)).analyticsId) missing.push(spec)
      }
      const done: string[] = []
      for (const spec of missing) if (await this.#ensureWebsite(spec)) done.push(spec.name)
      if (done.length > 0) await this.refreshSites()
      if (done.length === missing.length || attempt >= attempts) return done
      await new Promise((resolve) => setTimeout(resolve, retryMs))
    }
  }

  async #refreshSites(): Promise<string[]> {
    const pending: { spec: AppSpec; files: AppFiles; site: string }[] = []
    for (const spec of await this.#store.list()) {
      // Compose files carry DATABASE_URL and app.json the env; older ones were written
      // readable by everyone.
      await this.#store.lockDown(spec.name)
      const files = await this.#store.read(spec.name)
      const service = files && composeService(files.compose)
      if (!files || !service) continue
      const { analyticsId } = await this.#store.readSecrets(spec.name)
      const site = renderSite(spec, this.settings, service, analyticsId)
      if (files.site !== site) pending.push({ spec, files, site })
    }
    // The user pool's own host follows the apps domain and the edge, like the apps' sites.
    const poolSite = renderPoolSite(this.settings)
    const previousPoolSite = await this.#store.readSite(POOL_SITE)
    const poolChanged = previousPoolSite !== poolSite
    if (pending.length === 0 && !poolChanged) return []
    // Protected apps' new hosts go behind Access before Caddy serves them, next to the old
    // ones: whatever fails from here on (another app's Access update, Caddy's reload), every
    // host that might be served stays protected. It narrows to the new hosts at the end.
    const access = this.#access
    const protectedSpecs = pending.filter((p) => p.spec.protected).map((p) => p.spec)
    if (access) {
      for (const spec of protectedSpecs) {
        await this.#cloudflare(`protect ${spec.name} with Cloudflare Access`, () =>
          access.extend(spec.name, servedHosts(spec, this.settings.appsDomain)),
        )
      }
    }
    for (const { spec, files, site } of pending)
      await this.#store.write(spec.name, { ...files, site })
    if (poolChanged) await this.#store.writeSite(POOL_SITE, poolSite)
    const reload = await this.#reloadCaddy()
    if (reload.code !== 0) {
      // Put the previous sites back, so Caddy keeps a configuration it accepts; the next
      // attempt rewrites them again.
      for (const { spec, files } of pending) await this.#store.write(spec.name, files)
      if (poolChanged) await this.#store.writeSite(POOL_SITE, previousPoolSite ?? '')
      await this.#reloadCaddy()
      throw new AgentError('Caddy rejected the rewritten sites', 500, tail(reload))
    }
    // The old hosts are gone from Caddy now; protection can drop them (extra hosts would be
    // harmless, so a failure here only leaves them listed).
    if (access) {
      for (const spec of protectedSpecs) {
        await access
          .sync(spec.name, servedHosts(spec, this.settings.appsDomain), true)
          .catch(() => {})
      }
    }
    return [...pending.map((p) => p.spec.name), ...(poolChanged ? [POOL_SITE] : [])]
  }

  /**
   * The env Spotcraft gives the app (ADR 0034), which wins over its own: its port, name,
   * release, secret and address; the user pool's (with an issuer and an address); its schema
   * (on a server with Postgres).
   */
  async #platformEnv(spec: AppSpec, { move = false } = {}): Promise<Record<string, string>> {
    // The schema first: if it can't be prepared, nothing about the app is written yet.
    const database = this.#databases ? await this.#provision(spec.name, { move }) : {}
    const env: Record<string, string> = {
      PORT: String(spec.port),
      APP_NAME: spec.name,
      APP_RELEASE: spec.tag,
      APP_SECRET: await this.#appSecret(spec.name),
    }
    const url = publicUrl(spec, this.settings.appsDomain)
    if (url) env.PUBLIC_URL = url
    if (url && this.settings.authIssuer) {
      env.AUTH_URL = `${url}${POOL_PATH}`
      env.AUTH_ISSUER = this.settings.authIssuer
      env.AUTH_JWKS_URL = `${url}${POOL_PATH}/jwks`
    }
    return { ...env, ...database }
  }

  /** The app's APP_SECRET: 32 random bytes, made on its first deploy and kept in secrets.json. */
  async #appSecret(name: string): Promise<string> {
    const stored = (await this.#store.readSecrets(name)).appSecret
    if (stored) return stored
    return this.#withSecrets(async () => {
      const current = await this.#store.readSecrets(name)
      if (current.appSecret) return current.appSecret
      const appSecret = randomBytes(32).toString('base64url')
      await this.#store.writeSecrets(name, { ...current, appSecret })
      return appSecret
    })
  }

  /**
   * Runs the image's migrate command once, in a container of the new slot's service: the app's
   * env, network and limits, the command in place of the image's entrypoint. It has
   * MIGRATE_SECONDS; the container is removed either way.
   */
  async #migrate(spec: AppSpec, service: string, command: string[]): Promise<RunResult> {
    const container = `${projectName(spec.name)}-migrate`
    await this.#run('docker', ['rm', '--force', container])
    const [entrypoint, ...args] = command
    const result = await this.#run(
      'docker',
      [
        'compose',
        '-p',
        projectName(spec.name),
        '-f',
        this.#store.stagedComposePath(spec.name),
        'run',
        '--rm',
        '--no-deps',
        '-T',
        '--name',
        container,
        '--entrypoint',
        entrypoint,
        service,
        ...args,
      ],
      (MIGRATE_SECONDS + 15) * 1000,
    )
    if (result.code !== 0) await this.#run('docker', ['rm', '--force', container])
    return result
  }

  /**
   * For an image without a HEALTHCHECK: asks the new slot for `GET /health` from Caddy's
   * container (which shares its network) until it answers. 2xx is healthy; 404 means the app
   * has no such route but answers on its port, which is enough. Anything else, or no answer,
   * is tried again for PROBE_SECONDS.
   */
  async #probe(spec: AppSpec, service: string): Promise<RunResult> {
    const url = `http://${upstreamAlias(service)}:${spec.port}/health`
    const deadline = Date.now() + this.probe.seconds * 1000
    let last: RunResult = { code: 1, stdout: '', stderr: 'not tried' }
    while (Date.now() < deadline) {
      // Caddy runs from Spotcraft's image, which has Node and no wget (ADR 0038).
      last = await this.#run('docker', [
        'exec',
        this.#caddyContainer,
        '/nodejs/bin/node',
        '-e',
        PROBE_SCRIPT,
        url,
      ])
      if (last.code === 0) return last
      await new Promise((resolve) => setTimeout(resolve, this.probe.intervalMs))
    }
    return {
      ...last,
      stderr: `No answer from ${url} within ${this.probe.seconds} s: ${last.stderr}`,
    }
  }

  /** Prepares the app's database with its stored password (generated the first time). */
  async #provision(name: string, { move = false } = {}): Promise<Record<string, string>> {
    if (!this.#databases) {
      throw new AgentError('This server has no Postgres configured for app databases', 409)
    }
    const secrets = await this.#store.readSecrets(name)
    const password = secrets.databasePassword ?? randomBytes(24).toString('hex')
    let env: Record<string, string>
    try {
      env = await this.#databases.provision(name, password, { move })
    } catch (error) {
      throw new AgentError(`Could not prepare the database for ${name}`, 502, message(error))
    }
    if (!secrets.databasePassword) {
      // Read again under the secrets lock: a hook token may have been written meanwhile.
      await this.#withSecrets(async () => {
        const current = await this.#store.readSecrets(name)
        if (!current.databasePassword) {
          await this.#store.writeSecrets(name, { ...current, databasePassword: password })
        }
      })
    }
    return env
  }

  /** Where the app's tables are; `none` on a server without Postgres. */
  async databaseLayout(name: string): Promise<'schema' | 'database' | 'none'> {
    if (!(await this.#store.get(name))) throw new AgentError('No such app', 404)
    return this.#databases ? this.#databases.layout(name) : 'none'
  }

  /**
   * Moves an app made before ADR 0034 from its own database into its schema, deploying `tag`,
   * a version made for the schema and the pool (ADR 0035): a backup first (if backups are set
   * up), then the deploy, which copies the guests, sessions and rows between the new version's
   * migrations and its start. The old database stays, unused, until someone drops it. If any
   * of it fails, the schema goes and the old version keeps running on its own database.
   */
  move(name: string, tag: string): Promise<{ status: AppStatus; moved: Moved }> {
    return this.#exclusive(async () => {
      const databases = this.#databases
      if (!databases) throw new AgentError('This server has no Postgres, so nothing to move', 409)
      const spec = await this.#store.get(name)
      if (!spec) throw new AgentError('No such app', 404)
      if ((await databases.layout(name)) !== 'database') {
        throw new AgentError(`${name} has no database of its own to move`, 409)
      }
      if (this.#backups) {
        const backup = await this.#backup(name)
        if (!backup.ok) throw new AgentError(`Could not back ${name} up first`, 502, backup.error)
      }
      let moved: Moved | undefined
      const formerSecret = spec.env.AUTH_SECRET || undefined
      try {
        const status = await this.#deploy(
          { ...spec, tag },
          {
            takeOver: false,
            move: async () => {
              try {
                moved = await databases.move(name, { formerSecret })
              } catch (error) {
                throw new AgentError(`Could not copy ${name} into its schema`, 502, message(error))
              }
            },
          },
        )
        if (this.#releases.get(name)?.state !== 'deploying') this.#releases.delete(name)
        return { status, moved: moved as Moved }
      } catch (error) {
        await databases.dropSchema(name).catch((dropError: unknown) => {
          console.warn(`could not drop the schema of ${name}: ${message(dropError)}`)
        })
        throw error
      }
    })
  }

  /**
   * Brings every app database up to date (role settings and grants), e.g.
   * after Spotcraft was upgraded. Each app is tried even if another fails.
   */
  upgradeDatabases(): Promise<{ upgraded: string[]; failed: { name: string; error: string }[] }> {
    return this.#exclusive(async () => {
      const result = { upgraded: [] as string[], failed: [] as { name: string; error: string }[] }
      if (!this.#databases) return result
      for (const spec of await this.#store.list()) {
        if (!spec.database) continue
        try {
          await this.#provision(spec.name)
          result.upgraded.push(spec.name)
        } catch (error) {
          const detail = error instanceof AgentError ? error.output : message(error)
          result.failed.push({ name: spec.name, error: detail })
        }
      }
      return result
    })
  }

  /** The last backup of the app; undefined if there was none. */
  backupStatus(name: string): Promise<BackupStatus | undefined> {
    return this.#store.readBackupStatus(name)
  }

  /**
   * Backs the app up now, in the queue (so never during one of its deploys). One at a time per
   * app: while one waits or runs, asking again is refused.
   */
  async backup(name: string): Promise<BackupStatus> {
    if (!this.#backups) throw new AgentError('Backups are not set up on this server', 409)
    if (this.#backingUp.has(name))
      throw new AgentError(`A backup of ${name} is already queued`, 409)
    this.#backingUp.add(name)
    try {
      return await this.#exclusive(async () => {
        if (!(await this.#store.get(name))) throw new AgentError('No such app', 404)
        return this.#backup(name)
      })
    } finally {
      this.#backingUp.delete(name)
    }
  }

  /**
   * Backs up every app, one at a time, each in its own turn in the queue so deploys can go
   * between them, then the platform's databases (the pool under `POOL_BACKUP`, analytics under
   * `ANALYTICS_BACKUP`). A failure doesn't stop the others;
   * its status says why.
   */
  async backupAll(): Promise<Record<string, BackupStatus>> {
    const result: Record<string, BackupStatus> = {}
    if (!this.#backups) return result
    for (const spec of await this.#store.list()) {
      const status = await this.#exclusive(async () =>
        (await this.#store.get(spec.name)) ? this.#backup(spec.name) : undefined,
      )
      if (status) result[spec.name] = status
    }
    for (const platform of this.#backups.platform)
      result[platform.folder] = await this.#exclusive(() => this.#backupPlatform(platform))
    return result
  }

  /**
   * One of the platform's databases, as `<folder>/<time>/<file>`, such as
   * `_auth/<time>/auth.dump`. Their secrets are in the server's .env, which Hetzner's backups
   * hold.
   */
  async #backupPlatform({ folder, file, dump }: PlatformDump): Promise<BackupStatus> {
    const backups = this.#backups
    if (!backups) throw new AgentError('Backups are not set up on this server', 409)
    const key = `${folder}/${backupStamp(backups.now())}/`
    try {
      const data = await dump()
      await backups.target.put(`${key}${file}`, data)
      const at = backups.now().toISOString()
      return { at, ok: true, key, bytes: data.length, lastOkAt: at }
    } catch (error) {
      const status = { at: backups.now().toISOString(), ok: false, error: message(error) }
      console.warn(`backup of ${folder} failed: ${status.error}`)
      return status
    }
  }

  /**
   * One backup, under `<name>/<time>/` in the bucket: `database.dump` (if the app has a
   * database), then `app.json` and `secrets.json`. Without AUTH_SECRET and the like from these,
   * a restored database would sign every guest out. Writes the status, failed or not.
   */
  async #backup(name: string): Promise<BackupStatus> {
    const backups = this.#backups
    if (!backups) throw new AgentError('Backups are not set up on this server', 409)
    const previous = await this.#store.readBackupStatus(name)
    const key = `${name}/${backupStamp(backups.now())}/`
    let status: BackupStatus
    try {
      const spec = await this.#store.get(name)
      const files = await this.#store.backupFiles(name)
      if (!spec || !files) throw new Error(`${name} has no settings on disk`)
      let bytes = 0
      if (spec.database) {
        const dump = await backups.dump(name)
        bytes = dump.length
        await backups.target.put(`${key}database.dump`, dump)
      }
      await backups.target.put(`${key}app.json`, Buffer.from(files.spec), 'application/json')
      await backups.target.put(`${key}secrets.json`, Buffer.from(files.secrets), 'application/json')
      const at = backups.now().toISOString()
      status = { at, ok: true, key, bytes, lastOkAt: at }
    } catch (error) {
      status = {
        at: backups.now().toISOString(),
        ok: false,
        error: message(error),
        ...(previous?.lastOkAt ? { lastOkAt: previous.lastOkAt } : {}),
      }
      console.warn(`backup of ${name} failed: ${status.error}`)
    }
    await this.#store.writeBackupStatus(name, status)
    return status
  }

  /** The pool's database interface, or 409 on a server without Postgres. */
  #poolDatabase(): Databases {
    if (!this.#databases) throw new AgentError('This server has no Postgres, so no user pool', 409)
    return this.#databases
  }

  /** A page of the user pool's users (ADR 0035). */
  listUsers(page: { limit: number; cursor?: string }): Promise<UserPage> {
    return this.#poolDatabase().listUsers(page)
  }

  /** Deletes a pool user; 409 when an app's foreign key keeps their rows (a bug in that app). */
  async deleteUser(id: string): Promise<boolean> {
    try {
      return await this.#poolDatabase().deleteUser(id)
    } catch (error) {
      if ((error as { code?: string }).code === '23503') {
        const detail = (error as { detail?: string; table?: string }).table
        throw new AgentError(
          `An app keeps rows for this user that can't be deleted with them${detail ? ` (${detail})` : ''}`,
          409,
          message(error),
        )
      }
      throw error
    }
  }

  /**
   * Stops and removes the app. Its database is kept unless `purge` is set, so removing an
   * app by mistake loses no data; with `purge`, the database and its role are dropped.
   */
  remove(name: string, { purge = false } = {}): Promise<boolean> {
    return this.#exclusive(async () => {
      const spec = await this.#store.get(name)
      if (!spec) return false
      const down = await this.#compose(name, ['down', '--remove-orphans'])
      if (down.code !== 0) throw new AgentError(`Could not stop ${name}`, 500, tail(down))
      const { analyticsId } = await this.#store.readSecrets(name)
      await this.#store.remove(name)
      // Its numbers go with it. Umami being down mustn't keep an app from being removed.
      if (analyticsId && this.analytics) {
        await this.analytics
          .deleteWebsite(analyticsId)
          .catch((error) => console.warn(`could not delete ${name}'s analytics: ${message(error)}`))
      }
      this.#forgetReleases(name)
      await this.#reloadCaddy()
      try {
        await this.#domains?.detach(name, customHosts(spec))
        await this.#access?.sync(name, [], false)
      } catch (error) {
        throw new AgentError(
          `${name} was removed, but its DNS records or Access application could not be deleted`,
          500,
          message(error),
        )
      }
      if (purge && this.#databases) {
        try {
          await this.#databases.purge(name)
        } catch (error) {
          throw new AgentError(
            `${name} was removed, but its database could not be deleted`,
            500,
            message(error),
          )
        }
      }
      return true
    })
  }

  async logs(name: string, lines: number): Promise<string | undefined> {
    if (!(await this.#store.read(name))) return undefined
    const result = await this.#compose(name, [
      'logs',
      '--tail',
      String(lines),
      '--no-color',
      '--timestamps',
    ])
    return `${result.stdout}${result.stderr}`
  }
}
