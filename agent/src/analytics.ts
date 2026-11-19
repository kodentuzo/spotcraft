import type { VisitSummary } from './apps.ts'

/**
 * The instance's analytics, Umami (ADR 0038), as the agent uses it: one Umami "website" per app,
 * the bucket its page views and events go into. The agent signs in as Umami's `admin`; the first
 * time, that account still has Umami's default password, which the agent replaces with its own.
 */
export interface Analytics {
  /**
   * The id of the app's website: `known` if Umami still has it, else a new one made for the
   * app, named after it, for its first host.
   */
  ensureWebsite(name: string, domain: string, known?: string): Promise<string>
  /** Deletes the website and its numbers; one that is already gone is fine. */
  deleteWebsite(id: string): Promise<void>
  /** What the website counted over the last `days` days, and the days before. */
  /** With `brief`, only the totals: one call to Umami instead of one per breakdown. */
  summary(id: string, days: number, brief?: boolean): Promise<VisitSummary>
}

/** Umami's account on a fresh install. Nothing exposes it: Caddy routes only the tracker. */
const DEFAULT_PASSWORD = 'umami'

export class UmamiError extends Error {}

export class Umami implements Analytics {
  readonly #url: string
  readonly #password: string
  readonly #fetch: typeof fetch
  readonly #timeoutMs: number
  #token: string | undefined

  constructor(
    url: string,
    password: string,
    options: { fetch?: typeof fetch; timeoutMs?: number } = {},
  ) {
    if (password.length < 8) throw new UmamiError('The Umami password needs at least 8 characters')
    this.#url = url.replace(/\/$/, '')
    this.#password = password
    this.#fetch = options.fetch ?? fetch
    this.#timeoutMs = options.timeoutMs ?? 5000
  }

  async ensureWebsite(name: string, domain: string, known?: string): Promise<string> {
    if (known) {
      const found = await this.#call('GET', `/api/websites/${encodeURIComponent(known)}`)
      if (!found.ok && found.status !== 404) {
        throw await this.#error(found, `look up the website of ${name}`)
      }
      // For an admin, Umami answers 200 with `null` for a website it doesn't have.
      const website = found.ok ? ((await found.json()) as { id?: unknown } | null) : null
      if (website?.id === known) return known
    }
    const made = await this.#call('POST', '/api/websites', { name, domain })
    if (!made.ok) throw await this.#error(made, `make a website for ${name}`)
    const { id } = (await made.json()) as { id?: unknown }
    if (typeof id !== 'string')
      throw new UmamiError(`Umami made a website for ${name} without an id`)
    return id
  }

  async summary(id: string, days: number, brief = false): Promise<VisitSummary> {
    const endAt = Date.now()
    const startAt = endAt - days * 24 * 60 * 60 * 1000
    const range = `startAt=${startAt}&endAt=${endAt}`
    const base = `/api/websites/${encodeURIComponent(id)}`
    const get = async <T>(path: string): Promise<T> => {
      const response = await this.#call('GET', `${base}${path}`)
      if (!response.ok) throw await this.#error(response, `read the numbers of website ${id}`)
      return (await response.json()) as T
    }
    type Stats = { pageviews: number; visitors: number; visits: number }
    type Metric = { x: string | null; y: number }[]
    const metric = (type: string): Promise<Metric> =>
      brief ? Promise.resolve([]) : get<Metric>(`/metrics?${range}&type=${type}&limit=10`)
    // A breakdown Umami can't give leaves its list empty; the totals still show.
    const breakdown = (type: string) =>
      metric(type).then(
        (rows) =>
          Array.isArray(rows) ? rows.map(({ x, y }) => ({ name: x ?? '(unknown)', count: y })) : [],
        () => [],
      )
    type Series = { x: string; y: number }[]
    type Daily = { pageviews?: Series; sessions?: Series }
    const perDay = (
      brief ? Promise.resolve<Daily>({}) : get<Daily>(`/pageviews?${range}&unit=day&timezone=UTC`)
    ).then(
      ({ pageviews, sessions }) => {
        const byDay = new Map<string, { day: string; views: number; visitors: number }>()
        const at = (x: string) => {
          const day = String(x).slice(0, 10)
          const entry = byDay.get(day) ?? { day, views: 0, visitors: 0 }
          byDay.set(day, entry)
          return entry
        }
        for (const { x, y } of Array.isArray(pageviews) ? pageviews : []) at(x).views += y
        for (const { x, y } of Array.isArray(sessions) ? sessions : []) at(x).visitors += y
        return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
      },
      () => [],
    )
    const [
      stats,
      pages,
      systems,
      hostnames,
      referrers,
      countries,
      devices,
      browsers,
      events,
      daily,
    ] = await Promise.all([
      get<Stats & { comparison?: Partial<Stats> }>(`/stats?${range}`),
      metric('path'),
      metric('os'),
      breakdown('hostname'),
      breakdown('referrer'),
      breakdown('country'),
      breakdown('device'),
      breakdown('browser'),
      breakdown('event'),
      perDay,
    ])
    return {
      days,
      views: stats.pageviews ?? 0,
      visitors: stats.visitors ?? 0,
      visits: stats.visits ?? 0,
      previous: {
        views: stats.comparison?.pageviews ?? 0,
        visitors: stats.comparison?.visitors ?? 0,
      },
      pages: pages.map(({ x, y }) => ({ path: x ?? '(unknown)', views: y })),
      systems: systems.map(({ x, y }) => ({ name: x ?? '(unknown)', visitors: y })),
      hostnames,
      referrers,
      countries,
      devices,
      browsers,
      events,
      perDay: daily,
    }
  }

  async deleteWebsite(id: string): Promise<void> {
    const gone = await this.#call('DELETE', `/api/websites/${encodeURIComponent(id)}`)
    if (!gone.ok && gone.status !== 404) throw await this.#error(gone, `delete website ${id}`)
  }

  /** One API call, signed in; signs in again once if the token was refused. */
  async #call(method: string, path: string, body?: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = this.#token ?? (await this.#signIn())
      const response = await this.#send(method, path, body, token)
      if (response.status !== 401 || attempt > 0) return response
      this.#token = undefined
    }
  }

  /** Signs in with the agent's password, or, on a fresh install, replaces the default one. */
  async #signIn(): Promise<string> {
    const own = await this.#login(this.#password)
    if (own) {
      this.#token = own
      return own
    }
    const fresh = await this.#login(DEFAULT_PASSWORD)
    if (!fresh) throw new UmamiError("Umami refused the agent's password (UMAMI_ADMIN_PASSWORD)")
    const changed = await this.#send(
      'POST',
      '/api/me/password',
      { currentPassword: DEFAULT_PASSWORD, newPassword: this.#password },
      fresh,
    )
    if (!changed.ok) throw await this.#error(changed, "replace Umami's default password")
    const token = await this.#login(this.#password)
    if (!token) throw new UmamiError('Umami refused the password it was just given')
    this.#token = token
    return token
  }

  async #login(password: string): Promise<string | undefined> {
    const response = await this.#send('POST', '/api/auth/login', { username: 'admin', password })
    if (response.status === 401 || response.status === 400) return undefined
    if (!response.ok) throw await this.#error(response, 'sign in to Umami')
    const { token } = (await response.json()) as { token?: unknown }
    if (typeof token !== 'string') throw new UmamiError('Umami signed in without a token')
    return token
  }

  async #send(method: string, path: string, body: unknown, token?: string): Promise<Response> {
    try {
      return await this.#fetch(`${this.#url}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
    } catch (error) {
      throw new UmamiError(`Umami did not answer: ${(error as Error).message}`)
    }
  }

  async #error(response: Response, what: string): Promise<UmamiError> {
    const text = (await response.text().catch(() => '')).slice(0, 200)
    return new UmamiError(`Could not ${what}: Umami answered ${response.status} ${text}`.trim())
  }
}
