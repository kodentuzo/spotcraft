import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { anonymous, bearer, jwt } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/node-postgres'
import type pg from 'pg'
import type { Config } from './config.ts'
import { accounts, jwks, sessions, users, verifications } from './schema.ts'

/** Where the pool answers on every app's domain; Caddy routes it here (ADR 0035). */
export const BASE_PATH = '/_spotcraft/auth'

/** The header Caddy sets to the client address it resolved, replacing anything the client sent. */
export const CLIENT_IP_HEADER = 'x-spotcraft-client-ip'

const DAY = 24 * 60 * 60

/** A host name as Caddy passes it on, with an optional port. */
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/

/**
 * The instance's user pool, `main`: Better Auth over the `auth` schema, for guests for now.
 * Returns the pool as seen from one host.
 *
 * - **Every app's domain** reaches it at `/_spotcraft/auth`, so each host gets its own Better
 *   Auth with that host as its base URL: the session cookie is first-party on that domain, and
 *   only that origin (plus the configured ones, for bearer clients) passes the origin check.
 *   Better Auth's dynamic base URL would trust every origin its host patterns match, which for
 *   "any host" means every site. Caddy only passes on hosts it serves for the instance.
 * - **Tokens:** `bearer` for clients without cookies, `jwt` for apps to verify (JWKS). All
 *   hosts share the database, so the users, sessions and signing keys are the same.
 */
export function createPool(config: Config, client: pg.Pool) {
  const db = drizzle(client)
  const byHost = new Map<string, ReturnType<typeof forHost>>()

  const forHost = (host: string) =>
    betterAuth({
      appName: 'Spotcraft',
      baseURL: `${config.protocol}://${host}`,
      basePath: BASE_PATH,
      secret: config.secret,
      database: drizzleAdapter(db, {
        provider: 'pg',
        schema: {
          user: users,
          session: sessions,
          account: accounts,
          verification: verifications,
          jwks,
        },
      }),
      trustedOrigins: config.trustedOrigins,
      advanced: {
        // On explicitly: Better Auth turns both off when it detects a test runner, so tests would
        // pass without them.
        disableOriginCheck: false,
        disableCSRFCheck: false,
        database: { generateId: 'uuid' },
        ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
        defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      },
      // Guests keep their data as long as they keep coming back.
      session: { expiresIn: 365 * DAY, updateAge: DAY },
      rateLimit: {
        enabled: true,
        storage: 'memory',
        customRules: { '/sign-in/anonymous': { window: 10 * 60, max: 30 } },
      },
      plugins: [
        anonymous(),
        bearer(),
        jwt({
          jwks: { keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' } },
          jwt: {
            issuer: config.issuer,
            expirationTime: '15m',
            definePayload: ({ user }) => ({ is_anonymous: Boolean(user.isAnonymous) }),
          },
        }),
      ],
      telemetry: { enabled: false },
    })

  return (rawHost: string) => {
    const host = rawHost.toLowerCase()
    if (!HOST.test(host)) return undefined
    let pool = byHost.get(host)
    if (!pool) {
      // A handful of app domains in practice; the bound only keeps a misconfiguration cheap.
      if (byHost.size >= 1000) byHost.delete(byHost.keys().next().value as string)
      pool = forHost(host)
      byHost.set(host, pool)
    }
    return pool
  }
}

export type Pools = ReturnType<typeof createPool>
export type Pool = NonNullable<ReturnType<Pools>>
