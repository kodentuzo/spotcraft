import { randomBytes } from 'node:crypto'
import { access, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { appRoleName } from './provision.ts'
import { LOCAL_ISSUER, poolUrl, type Stack, smtpUrl } from './stack.ts'

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

/**
 * The repository's root: the nearest folder up from `dir` with `.git` or `pnpm-workspace.yaml`,
 * else `dir`. Every deployable in a repository shares its stack (ADR 0037).
 */
export async function findRoot(dir: string): Promise<string> {
  for (let current = dir; ; current = dirname(current)) {
    if (
      (await exists(join(current, '.git'))) ||
      (await exists(join(current, 'pnpm-workspace.yaml')))
    )
      return current
    if (dirname(current) === current) return dir
  }
}

/** A name for the repository's stack: its folder's name, made safe for Compose. */
export function repoSlug(root: string): string {
  const slug = basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return slug || 'repo'
}

/** `spotcraft.json` in a deployable's folder (ADR 0034): its name and local migrate command. */
export interface SpotcraftJson {
  name?: string
  migrate?: string
}

export async function readSpotcraftJson(dir: string): Promise<SpotcraftJson> {
  let text: string
  try {
    text = await readFile(join(dir, 'spotcraft.json'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('spotcraft.json is not valid JSON')
  }
  const { name, migrate } = (parsed ?? {}) as Record<string, unknown>
  if (name !== undefined && typeof name !== 'string')
    throw new Error('spotcraft.json: "name" must be a string')
  if (migrate !== undefined && typeof migrate !== 'string')
    throw new Error('spotcraft.json: "migrate" must be a command, as a string')
  return { ...(name ? { name } : {}), ...(migrate ? { migrate } : {}) }
}

/**
 * The app's name: `--name`, else `name` in spotcraft.json, else the `name` in package.json,
 * made into a Spotcraft app name (`@acme/Blog_API` → `blog-api`). Throws when none gives a
 * valid one.
 */
export async function appName(dir: string, flag?: string): Promise<string> {
  let candidate = flag ?? (await readSpotcraftJson(dir)).name
  if (!candidate) {
    let pkg: { name?: unknown }
    try {
      pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    } catch {
      throw new Error('No spotcraft.json or package.json here; pass the app name with --name')
    }
    if (typeof pkg.name !== 'string') throw new Error('package.json has no name; pass --name')
    candidate = pkg.name
      .replace(/^@[^/]+\//, '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^[^a-z]+|-+$/g, '')
      .slice(0, 32)
      .replace(/-+$/, '')
  }
  try {
    appRoleName(candidate)
  } catch {
    throw new Error(
      `"${candidate}" is not a Spotcraft app name (lower-case letters, digits and dashes, 2–32 characters); pass --name`,
    )
  }
  return candidate
}

/** KEY=value lines of a .env file (comments and blank lines skipped). */
export function parseEnv(text: string): Map<string, string> {
  const entries = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line)
    if (match) entries.set(match[1], match[2].trim())
  }
  return entries
}

async function readEnvFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

/**
 * The settings an app gets locally, with the names the server uses (ADR 0034): its database
 * URL and schema, the local pool and mail, and an APP_SECRET kept if .env already has one.
 * An app that still has its own database (from before ADR 0034) gets that database and the
 * kit's AUTH_SECRET instead of a schema.
 */
export async function localEnv(
  dir: string,
  stack: Stack,
  app: { name: string; databaseUrl: string; schema?: string },
): Promise<Map<string, string>> {
  const existing = parseEnv(await readEnvFile(join(dir, '.env')))
  const secret = (key: string) => existing.get(key) || randomBytes(32).toString('base64url')
  if (!app.schema) {
    return new Map([
      ['DATABASE_URL', app.databaseUrl],
      ['AUTH_SECRET', existing.get('AUTH_SECRET') || randomBytes(32).toString('hex')],
    ])
  }
  return new Map([
    ['DATABASE_URL', app.databaseUrl],
    ['DATABASE_SCHEMA', app.schema],
    ['APP_NAME', app.name],
    ['APP_SECRET', secret('APP_SECRET')],
    ['PUBLIC_URL', 'http://localhost:3000'],
    ['AUTH_URL', poolUrl(stack)],
    ['AUTH_ISSUER', LOCAL_ISSUER],
    ['AUTH_JWKS_URL', `${poolUrl(stack)}/jwks`],
    ['SMTP_URL', smtpUrl(stack)],
    ['MAIL_FROM', `${app.name}@localhost`],
  ])
}

/**
 * Adds the variables .env doesn't have yet, at the end, and leaves every existing line alone.
 * Returns which were added and which were already there (possibly with another value).
 */
export async function writeMissing(
  dir: string,
  values: Map<string, string>,
): Promise<{ added: string[]; kept: string[] }> {
  const path = join(dir, '.env')
  const text = await readEnvFile(path)
  const existing = parseEnv(text)
  const added = [...values.keys()].filter((key) => !existing.has(key))
  const kept = [...values.keys()].filter((key) => existing.has(key))
  if (added.length > 0) {
    const lines = added.map((key) => `${key}=${values.get(key)}`)
    const separator = text === '' || text.endsWith('\n') ? '' : '\n'
    const header = '# Local stack (spotcraft dev)\n'
    await writeFile(path, `${text}${separator}${header}${lines.join('\n')}\n`)
  }
  return { added, kept }
}
