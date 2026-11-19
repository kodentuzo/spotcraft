// App databases on a shared Postgres: the same code on the server (the agent) and on a laptop
// (`spotcraft dev`), so a database looks the same in both places (ADR 0036).
import pg from 'pg'

const { Client, escapeIdentifier: id, escapeLiteral: lit } = pg

/** Spotcraft app names (the agent's NAME pattern); they become role and database names. */
const APP_NAME = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/

/** The role and database of an app: `blog-api` → `app_blog_api` (names never contain `_`). */
export function appDatabaseName(name: string): string {
  if (!APP_NAME.test(name)) throw new Error(`Not a valid app name: ${name}`)
  return `app_${name.replaceAll('-', '_')}`
}

/** Limits per app role, so one app can't starve the others on the shared server. */
const CONNECTION_LIMIT = 20
const STATEMENT_TIMEOUT = '30s'
const IDLE_IN_TRANSACTION_TIMEOUT = '60s'

/** Runs `fn` connected as the admin and always closes the connection. */
async function asAdmin<T>(adminUrl: string, fn: (c: pg.Client) => Promise<T>) {
  const client = new Client({ connectionString: adminUrl })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

export interface ProvisionOptions {
  /** The app's name, e.g. `blog`; its role and database are `app_blog`. */
  name: string
  /** The password of the app's role; set again on every run. */
  password: string
}

/**
 * Creates (or brings up to date) an app's role and database, connected as `adminUrl`: a role
 * with CREATEDB and CREATEROLE, the agent's on the server. Running it again changes nothing
 * except the password, if it changed.
 *
 * The app role owns its database and everything in it. Only it and the admin may connect.
 * Nothing else is created: the app runs its own migrations.
 */
export async function provision(adminUrl: string, { name, password }: ProvisionOptions) {
  const role = appDatabaseName(name)
  if (password.length < 16) throw new Error('The app password must have at least 16 characters')

  await asAdmin(adminUrl, async (admin) => {
    const me = (await admin.query<{ me: string }>('SELECT current_user AS me')).rows[0].me
    const exists = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount
    // NOSUPERUSER only on CREATE: Postgres refuses it in ALTER from a non-superuser, even as
    // a no-op, and a role created without it can't gain it from the admin anyway.
    const attributes = `LOGIN NOCREATEDB NOCREATEROLE CONNECTION LIMIT ${CONNECTION_LIMIT} PASSWORD ${lit(password)}`
    await admin.query(
      exists
        ? `ALTER ROLE ${id(role)} ${attributes}`
        : `CREATE ROLE ${id(role)} NOSUPERUSER ${attributes}`,
    )
    await admin.query(`ALTER ROLE ${id(role)} SET statement_timeout = ${lit(STATEMENT_TIMEOUT)}`)
    await admin.query(
      `ALTER ROLE ${id(role)} SET idle_in_transaction_session_timeout = ${lit(IDLE_IN_TRANSACTION_TIMEOUT)}`,
    )
    // Postgres only lets a role give a database to an owner it may SET ROLE to. The admin
    // doesn't inherit the app's rights.
    await admin.query(`GRANT ${id(role)} TO ${id(me)} WITH INHERIT FALSE, SET TRUE`)

    const hasDatabase = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [role]))
      .rowCount
    if (!hasDatabase) await admin.query(`CREATE DATABASE ${id(role)} OWNER ${id(role)}`)

    // Only the owner can take back the default CONNECT for everyone; as the admin, the REVOKE
    // would silently do nothing. The owner then lets the admin in, for backups and for the
    // `auth` schema that databases made before ADR 0035 still have.
    await admin.query(`SET ROLE ${id(role)}`)
    await admin.query(`REVOKE ALL ON DATABASE ${id(role)} FROM PUBLIC`)
    await admin.query(`GRANT CONNECT, CREATE ON DATABASE ${id(role)} TO ${id(me)}`)
    await admin.query('RESET ROLE')
  })
}

/** Drops an app's database and role. Nothing happens if they don't exist. */
export async function purge(adminUrl: string, name: string) {
  const role = appDatabaseName(name)
  await asAdmin(adminUrl, async (admin) => {
    const exists = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount
    if (!exists) return
    const me = (await admin.query<{ me: string }>('SELECT current_user AS me')).rows[0].me
    await admin.query(`GRANT ${id(role)} TO ${id(me)} WITH INHERIT FALSE, SET TRUE`)
    // As the owner, which may drop its database and end its own open connections.
    await admin.query(`SET ROLE ${id(role)}`)
    await admin.query(`DROP DATABASE IF EXISTS ${id(role)} WITH (FORCE)`)
    await admin.query('RESET ROLE')
    await admin.query(`DROP ROLE ${id(role)}`)
  })
}
