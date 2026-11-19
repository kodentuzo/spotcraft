import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { appRoleName, INSTANCE } from './provision.ts'

/**
 * The local stack of one repository (ADR 0037): Postgres set up like the Spotcraft server's,
 * the user pool, and Mailpit to catch email, as the Compose project
 * `spotcraft-dev-<repo>-<hash>`. Tests keep the values below equal to the server's files.
 */
export const PROJECT_PREFIX = 'spotcraft-dev-'

/**
 * A new stack's Compose project: the repository folder's slug and 6 hex characters of a hash of
 * its absolute path, so two checkouts with the same folder name get their own stacks.
 */
export function projectName(root: string, slug: string): string {
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 6)
  return `${PROJECT_PREFIX}${slug}-${hash}`
}

/** A name Compose accepts as a project name. */
const isProjectName = (name: unknown): name is string =>
  typeof name === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(name)

/** The server's Postgres image (infra/server/compose.yaml). */
export const POSTGRES_IMAGE =
  'postgres:18.7-trixie@sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc'

/** Catches every email apps send (SMTP), with a web inbox. */
export const MAILPIT_IMAGE =
  'axllent/mailpit:v1.33.1@sha256:aef2aacc11f075ec0fb6874275ee4a421e688e11a96ebb296134d1735c7761ce'

/** The user pool runs from the Spotcraft image of the same version as this CLI. */
export const SPOTCRAFT_IMAGE = 'vindotski/spotcraft'

/** Analytics (ADR 0038), the same image and version as on the server. */
export const UMAMI_IMAGE =
  'ghcr.io/umami-software/umami:3.4.1@sha256:e69d1a7932e9dab0fc523edc7be1f3a53f3c261f57856fc2167ae74a8fc022e8'

/** The local pool's `iss`; it names the pool, it is not an address. */
export const LOCAL_ISSUER = 'http://localhost/pools/main'

/** The server's Postgres login rules (infra/server/pg_hba.conf). */
export const PG_HBA = `# TYPE  DATABASE  USER      ADDRESS  METHOD
local   all       postgres           peer
local   all       all                reject
host    all       postgres  all      reject
host    all       all       all      scram-sha-256
`

/** The agent's role, exactly as the deploy script sets it up (infra/remote-deploy.sh). */
export const ADMIN_SQL = `SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spotcraft_agent') AS missing \\gset
\\if :missing
  CREATE ROLE spotcraft_agent LOGIN CREATEDB CREATEROLE PASSWORD :'pw';
\\else
  ALTER ROLE spotcraft_agent LOGIN CREATEDB CREATEROLE NOSUPERUSER PASSWORD :'pw';
\\endif
-- Roles the agent creates (one per app) are ones it may SET ROLE to, which Postgres requires
-- to make them a database's owner; it doesn't inherit their rights.
ALTER ROLE spotcraft_agent SET createrole_self_grant = 'set';
-- Apps get CONNECT on their own database only; the built-in ones are the agent's.
REVOKE CONNECT ON DATABASE postgres, template1 FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO spotcraft_agent;
-- The database apps share (ADR 0034), owned by the agent, and the group every app role joins.
-- The agent may grant the group to the app roles it makes, without inheriting its rights.
SELECT NOT EXISTS (SELECT FROM pg_database WHERE datname = 'apps') AS missing \\gset
\\if :missing
  CREATE DATABASE apps OWNER spotcraft_agent;
\\endif
REVOKE ALL ON DATABASE apps FROM PUBLIC;
SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spotcraft_app') AS missing \\gset
\\if :missing
  CREATE ROLE spotcraft_app NOLOGIN;
\\endif
GRANT spotcraft_app TO spotcraft_agent WITH ADMIN OPTION, INHERIT FALSE;
-- The user pool's role (ADR 0035): it owns the auth schema in apps, and nothing else.
SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spotcraft_auth') AS missing \\gset
\\if :missing
  CREATE ROLE spotcraft_auth LOGIN PASSWORD :'auth_pw';
\\else
  ALTER ROLE spotcraft_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'auth_pw';
\\endif
GRANT CONNECT ON DATABASE apps TO spotcraft_auth;
-- Analytics' role (ADR 0038): it owns the umami database, and nothing else.
SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spotcraft_umami') AS missing \\gset
\\if :missing
  CREATE ROLE spotcraft_umami LOGIN PASSWORD :'umami_pw';
\\else
  ALTER ROLE spotcraft_umami LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'umami_pw';
\\endif
SELECT NOT EXISTS (SELECT FROM pg_database WHERE datname = 'umami') AS missing \\gset
\\if :missing
  CREATE DATABASE umami OWNER spotcraft_umami;
\\endif
REVOKE ALL ON DATABASE umami FROM PUBLIC;
GRANT CONNECT ON DATABASE umami TO spotcraft_umami;
\\c apps
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION spotcraft_auth;
`

// Fixed local passwords keep DATABASE_URL the same across runs (and in .env). Acceptable only
// because every port is bound to 127.0.0.1 and the data is throwaway.
const SUPERUSER_PASSWORD = 'spotcraft-dev-superuser'
const ADMIN_PASSWORD = 'spotcraft-dev-admin-password'
const AUTH_PASSWORD = 'spotcraft-dev-auth-password'
const UMAMI_PASSWORD = 'spotcraft-dev-umami-password'
export const appPassword = (name: string) => `local-${name}-password`

/** A repository's stack: where it keeps its state, and the ports it was given. */
export interface Stack {
  /** The Compose project, `spotcraft-dev-<repo>-<hash>` (or `spotcraft-dev-<repo>` from 0.6.0). */
  project: string
  /** `.spotcraft/` in the repository's root. */
  stateDir: string
  ports: { postgres: number; auth: number; smtp: number; mail: number; analytics: number }
  /** The local pool's secret, made once. */
  authSecret: string
}

/** A free port on 127.0.0.1, as the system hands one out. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      )
    })
  })
}

/**
 * The repository's stack, from `.spotcraft/dev.json`, or a new one: free ports and the project
 * name picked once and kept, so URLs in `.env` stay the same. A `dev.json` from 0.6.0 has no
 * project name; it keeps that version's `spotcraft-dev-<slug>`, now written down.
 * `.spotcraft/` ignores itself in git.
 */
export async function loadStack(root: string, slug: string, ports = freePort): Promise<Stack> {
  const stateDir = join(root, '.spotcraft')
  const file = join(stateDir, 'dev.json')
  const save = async (stack: Stack) => {
    const { stateDir: _, ...saved } = stack
    await writeFile(file, `${JSON.stringify(saved, null, 2)}\n`)
  }
  const picked = new Set<number>()
  const next = async () => {
    for (;;) {
      const port = await ports()
      if (!picked.has(port)) {
        picked.add(port)
        return port
      }
    }
  }
  try {
    const saved = JSON.parse(await readFile(file, 'utf8')) as Partial<Omit<Stack, 'stateDir'>>
    if (saved.ports && saved.authSecret) {
      const { authSecret } = saved
      let changed = !isProjectName(saved.project)
      const project = isProjectName(saved.project) ? saved.project : `${PROJECT_PREFIX}${slug}`
      // A stack from before analytics (0.6) gets a port for it, kept like the others.
      for (const port of Object.values(saved.ports)) picked.add(port)
      const ports = { ...saved.ports }
      if (!ports.analytics) {
        ports.analytics = await next()
        changed = true
      }
      const stack = { project, stateDir, ports, authSecret }
      if (changed) await save(stack)
      return stack
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
      throw error
  }
  const stack: Stack = {
    project: projectName(root, slug),
    stateDir,
    ports: {
      postgres: await next(),
      auth: await next(),
      smtp: await next(),
      mail: await next(),
      analytics: await next(),
    },
    authSecret: randomBytes(32).toString('hex'),
  }
  await mkdir(stateDir, { recursive: true })
  await writeFile(join(stateDir, '.gitignore'), '*\n')
  await save(stack)
  return stack
}

export const adminUrl = (stack: Stack) =>
  `postgres://spotcraft_agent:${ADMIN_PASSWORD}@127.0.0.1:${stack.ports.postgres}/postgres`

/**
 * What the app gets, as on the server but on localhost: the instance database, or the app's own
 * one if it still has it (from before ADR 0034).
 */
export function databaseUrl(stack: Stack, name: string, database = INSTANCE.database): string {
  return `postgres://${appRoleName(name)}:${appPassword(name)}@127.0.0.1:${stack.ports.postgres}/${database}`
}

/** Where apps reach the local pool, mail and its inbox. */
export const poolUrl = (stack: Stack) => `http://localhost:${stack.ports.auth}/_spotcraft/auth`
export const smtpUrl = (stack: Stack) => `smtp://localhost:${stack.ports.smtp}`
export const mailUrl = (stack: Stack) => `http://localhost:${stack.ports.mail}`
/** Umami's own interface, for a look at what an app sends (sign in as admin / umami). */
export const analyticsUrl = (stack: Stack) => `http://localhost:${stack.ports.analytics}`

const container = (stack: Stack, service: string) => `${stack.project}-${service}-1`

/** The pool's image: SPOTCRAFT_DEV_IMAGE (e.g. a local build), else this CLI's version. */
export function poolImage(version: string, env: NodeJS.ProcessEnv = process.env) {
  return env.SPOTCRAFT_DEV_IMAGE?.trim() || `${SPOTCRAFT_IMAGE}:${version}`
}

/** The Compose file, as JSON (valid YAML), passed to Docker on stdin. */
export function composeFile(stack: Stack, image: string): string {
  const local = (port: number, inside: number) => `127.0.0.1:${port}:${inside}`
  return JSON.stringify({
    name: stack.project,
    services: {
      postgres: {
        image: POSTGRES_IMAGE,
        restart: 'unless-stopped',
        environment: { POSTGRES_PASSWORD: SUPERUSER_PASSWORD },
        command: [
          'postgres',
          '-c',
          'hba_file=/etc/postgresql/pg_hba.conf',
          '-c',
          'password_encryption=scram-sha-256',
        ],
        configs: [{ source: 'pg_hba', target: '/etc/postgresql/pg_hba.conf' }],
        ports: [local(stack.ports.postgres, 5432)],
        volumes: ['data:/var/lib/postgresql'],
        healthcheck: {
          test: ['CMD', 'pg_isready', '-q', '-h', '/var/run/postgresql', '-U', 'postgres'],
          interval: '2s',
          timeout: '5s',
          retries: 30,
        },
      },
      // The user pool, as on the server, with plain HTTP and apps' dev servers trusted.
      auth: {
        image,
        restart: 'unless-stopped',
        working_dir: '/app/auth',
        command: ['src/index.ts'],
        environment: {
          PORT: '3000',
          AUTH_DATABASE_URL: `postgres://spotcraft_auth:${AUTH_PASSWORD}@postgres:5432/${INSTANCE.database}`,
          AUTH_SECRET: stack.authSecret,
          AUTH_ISSUER: LOCAL_ISSUER,
          AUTH_PROTOCOL: 'http',
          AUTH_LOCAL_ORIGINS: '1',
        },
        ports: [local(stack.ports.auth, 3000)],
        depends_on: { postgres: { condition: 'service_healthy' } },
        healthcheck: {
          test: [
            'CMD',
            '/nodejs/bin/node',
            '-e',
            "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))",
          ],
          interval: '2s',
          timeout: '3s',
          retries: 60,
        },
      },
      // Analytics, as on the server (ADR 0038), with its interface published for a look.
      umami: {
        image: UMAMI_IMAGE,
        restart: 'unless-stopped',
        environment: {
          DATABASE_URL: `postgresql://spotcraft_umami:${UMAMI_PASSWORD}@postgres:5432/umami`,
          APP_SECRET: stack.authSecret,
          TRACKER_SCRIPT_NAME: '_spotcraft/s.js',
          COLLECT_API_ENDPOINT: '/_spotcraft/e',
          DISABLE_TELEMETRY: '1',
          DISABLE_UPDATES: '1',
        },
        ports: [local(stack.ports.analytics, 3000)],
        depends_on: { postgres: { condition: 'service_healthy' } },
        healthcheck: {
          test: ['CMD', 'curl', '-fsS', '-o', '/dev/null', 'http://127.0.0.1:3000/api/heartbeat'],
          interval: '2s',
          timeout: '3s',
          retries: 90,
        },
      },
      mailpit: {
        image: MAILPIT_IMAGE,
        restart: 'unless-stopped',
        ports: [local(stack.ports.smtp, 1025), local(stack.ports.mail, 8025)],
        healthcheck: {
          test: ['CMD', '/mailpit', 'readyz'],
          interval: '2s',
          timeout: '3s',
          retries: 30,
        },
      },
    },
    volumes: { data: {} },
    configs: { pg_hba: { content: PG_HBA } },
  })
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs a command without a shell, optionally feeding `input` on stdin. */
export function run(file: string, args: string[], input?: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => resolve({ code: 127, stdout, stderr: error.message }))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    child.stdin.end(input ?? '')
  })
}

export type Runner = typeof run

export class StackError extends Error {}

/** Docker Compose for the stack; the file comes on stdin. */
function compose(stack: Stack, image: string, runner: Runner, args: string[]) {
  return runner(
    'docker',
    ['compose', '-p', stack.project, '-f', '-', ...args],
    composeFile(stack, image),
  )
}

function fail(what: string, result: RunResult): never {
  throw new StackError(`${what}\n${`${result.stderr}${result.stdout}`.trim()}`)
}

/**
 * Starts the stack (what isn't running yet): Postgres first, then the roles and schemas the
 * deploy script makes on a server, then the user pool and Mailpit, waiting until all are healthy.
 */
export async function up(stack: Stack, image: string, runner: Runner = run) {
  const docker = await runner('docker', ['version', '--format', '{{.Server.Version}}'])
  if (docker.code !== 0) fail('Docker is not running (the local stack needs it).', docker)
  const wait = ['up', '-d', '--wait', '--wait-timeout', '180']
  const postgres = await compose(stack, image, runner, [...wait, 'postgres'])
  if (postgres.code !== 0) fail('Could not start the local Postgres.', postgres)
  // As the OS user `postgres`: the superuser only logs in over the socket with `peer`.
  const roles = await runner(
    'docker',
    [
      'exec',
      '-i',
      '-u',
      'postgres',
      container(stack, 'postgres'),
      'psql',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    `\\set pw ${ADMIN_PASSWORD}\n\\set auth_pw ${AUTH_PASSWORD}\n\\set umami_pw ${UMAMI_PASSWORD}\n${ADMIN_SQL}`,
  )
  if (roles.code !== 0) fail("Could not set up the agent's and the user pool's roles.", roles)
  const rest = await compose(stack, image, runner, wait)
  if (rest.code !== 0) {
    fail(`Could not start the user pool or Mailpit (the pool's image is ${image}).`, rest)
  }
}

/** Stops the stack; the data stays in its volume. */
export async function down(stack: Stack, image: string, runner: Runner = run) {
  const stopped = await compose(stack, image, runner, ['stop'])
  if (stopped.code !== 0) fail('Could not stop the local stack.', stopped)
}

/** Whether the stack's Postgres is running. */
export async function isRunning(stack: Stack, runner: Runner = run): Promise<boolean> {
  const state = await runner('docker', [
    'inspect',
    '--format',
    '{{.State.Running}}',
    container(stack, 'postgres'),
  ])
  return state.code === 0 && state.stdout.trim() === 'true'
}

/** Every repository's stack on this machine, running or not, with its state. */
export async function listStacks(
  runner: Runner = run,
): Promise<{ name: string; status: string }[]> {
  const listed = await runner('docker', ['compose', 'ls', '--all', '--format', 'json'])
  if (listed.code !== 0) fail('Could not list the local stacks.', listed)
  const projects = JSON.parse(listed.stdout || '[]') as { Name: string; Status: string }[]
  return projects
    .filter((p) => p.Name.startsWith(PROJECT_PREFIX))
    .map((p) => ({ name: p.Name.slice(PROJECT_PREFIX.length), status: p.Status }))
}
