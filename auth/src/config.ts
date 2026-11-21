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
  /**
   * Only for a local stack (`spotcraft dev`): also trust any `http://localhost:<port>` and
   * `http://127.0.0.1:<port>`, where apps' dev servers run.
   */
  localOrigins: boolean
  /** The role every app role belongs to; it may read and reference `auth.users`. */
  appGroup: string
  /** The agent's role, which may list and delete users for the dashboard. */
  adminRole: string
  /** Guests unused for this many days are deleted. */
  guestDays: number
  /** A session's IP address and user agent are cleared once it is unused for this many days. */
  ipDays: number
  /** How long backups are kept; deleted users' ids are kept as long, to delete them again. */
  backupDays: number
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
  const days = (name: string, fallback: number) => {
    const value = Number(env[name]?.trim() || fallback)
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a whole number of days`)
    }
    return value
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
    localOrigins: env.AUTH_LOCAL_ORIGINS === '1',
    appGroup: env.AUTH_APP_GROUP?.trim() || 'spotcraft_app',
    adminRole: env.AUTH_ADMIN_ROLE?.trim() || 'spotcraft_agent',
    guestDays: days('AUTH_GUEST_DAYS', 180),
    ipDays: days('AUTH_IP_DAYS', 30),
    backupDays: days('AUTH_BACKUP_DAYS', 30),
  }
}
