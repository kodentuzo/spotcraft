import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AnalyticsMode, Edge } from './app-spec.ts'

/*
 * The legal facts (ADR 0043): who runs the instance, and what the platform does with personal
 * data, as data. Apps render their privacy policy and legal notice from them; the words live in
 * Spotstrap's core, keyed by the ids and codes here, so they can be translated.
 */

/** The owner's details, set once in the dashboard. */
export interface LegalOwner {
  /** The controller: a person or a company. */
  name: string
  /** The postal address, one line each. */
  address: string[]
  /** Where people send requests about their data. */
  email: string
  /** The supervisory authority people can complain to. */
  authority: { name: string; url: string }
  /** Who hosts the server, and in which country (ISO 3166-1 alpha-2, or EU). */
  hosting: { name: string; country: string }
}

/** GDPR Art. 6(1): (b) a contract, (f) legitimate interests, (a) consent. */
export type LegalBasis = 'contract' | 'legitimate-interests' | 'consent'

/** One processing of personal data the platform does for every app. */
export interface Processing {
  /**
   * What it is, which also says what data and why, in Spotstrap's copy:
   * - `hosting`: everything an app stores and serves, on the server;
   * - `edge`: requests pass through Cloudflare, which sees visitors' IP addresses;
   * - `accounts`: the user pool's accounts and their data in apps;
   * - `sessions`: the IP address and user agent of each session, against abuse;
   * - `backups`: nightly copies of every app's data and the accounts;
   * - `analytics`: page views and events, counted without cookies or ids, by a script in the
   *   browser. Absent in `server` mode, which counts nothing personal.
   */
  id: 'hosting' | 'edge' | 'accounts' | 'sessions' | 'backups' | 'analytics'
  basis: LegalBasis
  /**
   * How long the data is kept, in days: after it was last used, or for `backups` and
   * `analytics`, after the backup or event was made. Null when it isn't limited.
   */
  retentionDays: number | null
  /** Who processes it for the owner; absent when the instance does it itself. */
  processor?: { name: string; country: string | null }
  /** A transfer outside the EU, and what it rests on (`dpf`: the EU–US Data Privacy Framework). */
  transfer?: { country: string; basis: 'dpf' }
}

/** What `LEGAL_FACTS` and `/_spotcraft/legal.json` hold. */
export interface LegalFacts {
  version: 1
  /** When any fact last changed (YYYY-MM-DD): the policy's "last changed" date. */
  updated: string
  /** Null until the owner fills in their details. */
  controller: Omit<LegalOwner, 'hosting'> | null
  processing: Processing[]
}

/** What the agent knows about the instance, from its settings. */
export interface PlatformFacts {
  edge: Edge
  /** The backup bucket's endpoint, when backups are set up. */
  backupEndpoint?: string
  /** How long backups are kept (AUTH_BACKUP_DAYS, like backup_retention_days). */
  backupDays: number
  /** How visits are counted, and how long Umami's events are kept (ANALYTICS_DAYS). */
  analytics: { mode: AnalyticsMode; days: number }
  /** Idle guests are deleted after this many days (AUTH_GUEST_DAYS). */
  guestDays: number
  /** Sessions' IP addresses and user agents are cleared after this many days (AUTH_IP_DAYS). */
  ipDays: number
}

const CLOUDFLARE = { name: 'Cloudflare, Inc.', country: 'US' }

/** Who runs a backup bucket, from its endpoint; R2's EU jurisdiction keeps the data in the EU. */
function bucketProcessor(endpoint: string): Processing['processor'] {
  const host = new URL(endpoint).hostname
  if (host.endsWith('.r2.cloudflarestorage.com')) {
    return { name: CLOUDFLARE.name, country: host.includes('.eu.') ? 'EU' : null }
  }
  return { name: host, country: null }
}

/** The facts, apart from `updated`. */
export function buildFacts(
  owner: LegalOwner | null,
  platform: PlatformFacts,
): Omit<LegalFacts, 'updated'> {
  const processing: Processing[] = [
    {
      id: 'hosting',
      basis: 'contract',
      retentionDays: null,
      processor: owner?.hosting ?? { name: 'Hetzner Online GmbH', country: 'DE' },
    },
  ]
  if (platform.edge === 'cloudflare') {
    processing.push({
      id: 'edge',
      basis: 'legitimate-interests',
      retentionDays: null,
      processor: CLOUDFLARE,
      transfer: { country: 'US', basis: 'dpf' },
    })
  }
  processing.push(
    { id: 'accounts', basis: 'contract', retentionDays: platform.guestDays },
    { id: 'sessions', basis: 'legitimate-interests', retentionDays: platform.ipDays },
  )
  if (platform.backupEndpoint) {
    const processor = bucketProcessor(platform.backupEndpoint)
    processing.push({
      id: 'backups',
      basis: 'legitimate-interests',
      retentionDays: platform.backupDays,
      processor,
      ...(processor?.name === CLOUDFLARE.name
        ? { transfer: { country: 'US', basis: 'dpf' as const } }
        : {}),
    })
  }
  if (platform.analytics.mode !== 'server') {
    processing.push({
      id: 'analytics',
      basis: platform.analytics.mode === 'opt-in' ? 'consent' : 'legitimate-interests',
      retentionDays: platform.analytics.days,
    })
  }
  const controller = owner && {
    name: owner.name,
    address: owner.address,
    email: owner.email,
    authority: owner.authority,
  }
  return { version: 1, controller, processing }
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/** The owner's details from a request body, or an error naming what is missing or wrong. */
export function parseOwner(body: unknown): LegalOwner | string {
  const b = (body ?? {}) as Record<string, unknown>
  const authority = (b.authority ?? {}) as Record<string, unknown>
  const hosting = (b.hosting ?? {}) as Record<string, unknown>
  const owner: LegalOwner = {
    name: text(b.name, 200),
    address: (Array.isArray(b.address) ? b.address : String(b.address ?? '').split('\n'))
      .map((line) => text(line, 200))
      .filter(Boolean)
      .slice(0, 8),
    email: text(b.email, 254),
    authority: { name: text(authority.name, 200), url: text(authority.url, 500) },
    hosting: {
      name: text(hosting.name, 200) || 'Hetzner Online GmbH',
      country: (text(hosting.country, 2) || 'DE').toUpperCase(),
    },
  }
  if (!owner.name) return 'Enter the name of the person or company that runs the apps'
  if (owner.address.length === 0) return 'Enter a postal address'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.email)) return 'Enter an email address'
  if (!owner.authority.name) return 'Enter the supervisory authority'
  if (
    !URL.canParse(owner.authority.url) ||
    !/^https?:$/.test(new URL(owner.authority.url).protocol)
  )
    return "Enter the supervisory authority's web address"
  if (!/^([A-Z]{2})$/.test(owner.hosting.country)) return 'Enter the hosting country as two letters'
  return owner
}

/**
 * JSON for a Caddyfile's backtick-quoted `respond` body: inside strings, backticks would end
 * the token and `{…}` would be read as a placeholder, so they are written as \u escapes, which
 * JSON reads back as the same characters.
 */
export function caddyJson(value: unknown): string {
  return JSON.stringify(value).replace(/"(?:[^"\\]|\\.)*"/g, (literal) =>
    literal.replace(/[`{}]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`),
  )
}

interface Stored {
  owner: LegalOwner | null
  updated: string
  /** A hash of the facts `updated` belongs to. */
  hash: string
}

const today = (now: Date) => now.toISOString().slice(0, 10)
const hashOf = (facts: Omit<LegalFacts, 'updated'>) =>
  createHash('sha256').update(JSON.stringify(facts)).digest('hex')

/**
 * The owner's details and the facts' date, in `<dataDir>/apps/.legal.json`: the agent's
 * container is read-only but for `apps/` and `sites/`, and `sites/` is Caddy's. The date moves
 * whenever the facts change, whether the owner changed their details or the instance changed
 * (a new edge, backups turned on).
 */
export class Legal {
  readonly #file: string
  readonly #platform: PlatformFacts
  readonly #now: () => Date

  constructor(dataDir: string, platform: PlatformFacts, now = () => new Date()) {
    this.#file = join(dataDir, 'apps', '.legal.json')
    this.#platform = platform
    this.#now = now
  }

  async #read(): Promise<Stored | undefined> {
    try {
      return JSON.parse(await readFile(this.#file, 'utf8')) as Stored
    } catch {
      return undefined
    }
  }

  async #write(stored: Stored) {
    await mkdir(dirname(this.#file), { recursive: true })
    const temp = `${this.#file}.tmp`
    await writeFile(temp, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, this.#file)
  }

  async owner(): Promise<LegalOwner | null> {
    return (await this.#read())?.owner ?? null
  }

  /**
   * The facts now, with the date they last changed. Deploys and every site need them, so a
   * date that can't be saved never fails them: it is logged, and saved on a later call.
   */
  async facts(): Promise<LegalFacts> {
    const stored = await this.#read()
    const facts = buildFacts(stored?.owner ?? null, this.#platform)
    const hash = hashOf(facts)
    if (stored?.hash === hash) return { ...facts, updated: stored.updated }
    const updated = today(this.#now())
    await this.#write({ owner: stored?.owner ?? null, updated, hash }).catch((error: unknown) => {
      console.warn(`could not save the legal facts' date: ${String(error)}`)
    })
    return { ...facts, updated }
  }

  /** Saves the owner's details; true when that changed the facts. */
  async setOwner(owner: LegalOwner): Promise<boolean> {
    // Brings the stored hash up to date with the instance first.
    const { updated } = await this.facts()
    const before = (await this.#read())?.hash
    const hash = hashOf(buildFacts(owner, this.#platform))
    const changed = hash !== before
    await this.#write({ owner, updated: changed ? today(this.#now()) : updated, hash })
    return changed
  }
}
