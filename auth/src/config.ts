export interface Config {
  host: string
  port: number
  logLevel: string
  /** The pool's role on the instance database, which owns the `auth` schema. */
  databaseUrl: string
  /** Signs session cookies and encrypts the signing keys; at least 32 characters. */
  secret: string
  /** The `iss` of every token, e.g. `https://auth.example.com/main`. */
  issuer: string
  /** `https` on a server; `http` only for a local stack. */
  protocol: 'https' | 'http'
  /** Origins that may call the pool from another site, with bearer tokens (Expo, other hosts). */
  trustedOrigins: string[]
  /** The role every app role belongs to; it may read and reference `auth.users`. */
  appGroup: string
  /** The agent's role, which may list and delete users for the dashboard. */
  adminRole: string
  /** Guests unused for this many days are deleted. */
  guestDays: number
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = required(env, 'AUTH_DATABASE_URL')
  if (!/^postgres(ql)?:\/\//.test(databaseUrl))
    throw new Error('AUTH_DATABASE_URL must be a postgres:// URL')
  const secret = required(env, 'AUTH_SECRET')
  if (secret.length < 32) throw new Error('AUTH_SECRET must be at least 32 characters')
  const issuer = required(env, 'AUTH_ISSUER')
  if (!URL.canParse(issuer)) throw new Error('AUTH_ISSUER must be a URL')
  const protocol = env.AUTH_PROTOCOL?.trim() || 'https'
  if (protocol !== 'https' && protocol !== 'http') {
    throw new Error('AUTH_PROTOCOL must be https or http')
  }
  const trustedOrigins = (env.AUTH_TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  for (const origin of trustedOrigins) {
    if (!URL.canParse(origin) || new URL(origin).origin !== origin) {
      throw new Error(`AUTH_TRUSTED_ORIGINS: ${origin} is not an origin like https://example.com`)
    }
  }
  const guestDays = Number(env.AUTH_GUEST_DAYS ?? 180)
  if (!Number.isInteger(guestDays) || guestDays < 1) {
    throw new Error('AUTH_GUEST_DAYS must be a whole number of days')
  }
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 3000),
    logLevel: env.LOG_LEVEL ?? 'info',
    databaseUrl,
    secret,
    issuer,
    protocol,
    trustedOrigins,
    appGroup: env.AUTH_APP_GROUP?.trim() || 'spotcraft_app',
    adminRole: env.AUTH_ADMIN_ROLE?.trim() || 'spotcraft_agent',
    guestDays,
  }
}
