// App schemas in the instance database: the same code on the server (the agent) and on a laptop
// (`spotcraft dev`), so an app's place in Postgres looks the same in both (ADRs 0034 and 0036).
import pg from 'pg'

const { Client, escapeIdentifier: id, escapeLiteral: lit } = pg

/** Where apps live in Postgres. Only tests use another one, to keep apart. */
export interface Instance {
  /** The one database every app shares, like a Supabase project. */
  database: string
  /**
   * The role every app role belongs to. The user pool grants it `SELECT` and `REFERENCES` on
   * `auth.users` (ADR 0035), so apps get those rights without the pool knowing each app.
   */
  group: string
}

export const INSTANCE: Instance = { database: 'apps', group: 'spotcraft_app' }

/** Spotcraft app names (the agent's NAME pattern); they become role and schema names. */
const APP_NAME = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/

/**
 * The app's role and schema: `blog-api` → `app_blog_api` (names never contain `_`). Apps made
 * before ADR 0034 also have a database of this name.
 */
export function appRoleName(name: string): string {
  if (!APP_NAME.test(name)) throw new Error(`Not a valid app name: ${name}`)
  return `app_${name.replaceAll('-', '_')}`
}

/** Limits per app role, so one app can't starve the others on the shared server. */
const CONNECTION_LIMIT = 20
const STATEMENT_TIMEOUT = '30s'
const IDLE_IN_TRANSACTION_TIMEOUT = '60s'

/** Runs `fn` connected as the admin (to `database`, or the URL's) and always disconnects. */
async function asAdmin<T>(
  adminUrl: string,
  database: string | undefined,
  fn: (c: pg.Client) => Promise<T>,
) {
  const url = new URL(adminUrl)
  if (database) url.pathname = `/${database}`
  const client = new Client({ connectionString: url.toString() })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

const currentUser = async (c: pg.Client) =>
  (await c.query<{ me: string }>('SELECT current_user AS me')).rows[0].me

const exists = async (c: pg.Client, sql: string, value: string) =>
  Boolean((await c.query(sql, [value])).rowCount)

/** Whether the app still has its own database, from before ADR 0034. */
export function hasOwnDatabase(adminUrl: string, name: string): Promise<boolean> {
  return asAdmin(adminUrl, undefined, (admin) =>
    exists(admin, 'SELECT 1 FROM pg_database WHERE datname = $1', appRoleName(name)),
  )
}

/**
 * Where the app's tables live: its schema in the instance database, its own database (from
 * before ADR 0034), or nowhere yet.
 */
export function appLayout(
  adminUrl: string,
  name: string,
  { database: instance } = INSTANCE,
): Promise<'schema' | 'database' | 'none'> {
  const role = appRoleName(name)
  return asAdmin(adminUrl, undefined, async (admin) => {
    if (await exists(admin, 'SELECT 1 FROM pg_database WHERE datname = $1', role)) return 'database'
    if (!(await exists(admin, 'SELECT 1 FROM pg_database WHERE datname = $1', instance)))
      return 'none'
    return asAdmin(adminUrl, instance, async (db) =>
      (await exists(db, 'SELECT 1 FROM pg_namespace WHERE nspname = $1', role)) ? 'schema' : 'none',
    )
  })
}

/**
 * Creates the instance database and the app group if they're missing. The admin owns the
 * database; nobody else may connect or create anything in `public`.
 */
async function ensureInstance(adminUrl: string, { database: instance, group }: Instance) {
  await asAdmin(adminUrl, undefined, async (admin) => {
    if (!(await exists(admin, 'SELECT 1 FROM pg_roles WHERE rolname = $1', group)))
      await admin.query(`CREATE ROLE ${id(group)} NOLOGIN`)
    if (!(await exists(admin, 'SELECT 1 FROM pg_database WHERE datname = $1', instance))) {
      await admin.query(`CREATE DATABASE ${id(instance)}`)
      await admin.query(`REVOKE ALL ON DATABASE ${id(instance)} FROM PUBLIC`)
    }
  })
  await asAdmin(adminUrl, instance, (db) => db.query('REVOKE ALL ON SCHEMA public FROM PUBLIC'))
}

export interface ProvisionOptions {
  /** The app's name, e.g. `blog`; its role and schema are `app_blog`. */
  name: string
  /** The password of the app's role; set again on every run. */
  password: string
  instance?: Instance
}

/**
 * Creates (or brings up to date) an app's role and schema in the instance database, connected
 * as `adminUrl`: a role with CREATEDB and CREATEROLE, the agent's on the server. Running it
 * again changes nothing except the password, if it changed. Returns the database the app
 * connects to.
 *
 * The role owns its schema and has it as its `search_path`. It may connect to the instance
 * database and nothing else: no schemas of its own, no other app's. An app that still has its
 * own database (from before ADR 0034) keeps it, and gets no schema until it moves.
 */
export async function provision(
  adminUrl: string,
  { name, password, instance: where = INSTANCE }: ProvisionOptions,
): Promise<{ database: string }> {
  const role = appRoleName(name)
  if (password.length < 16) throw new Error('The app password must have at least 16 characters')
  const ownDatabase = await hasOwnDatabase(adminUrl, name)
  const instance = where.database
  if (!ownDatabase) await ensureInstance(adminUrl, where)

  await asAdmin(adminUrl, undefined, async (admin) => {
    const me = await currentUser(admin)
    const roleExists = await exists(admin, 'SELECT 1 FROM pg_roles WHERE rolname = $1', role)
    // NOSUPERUSER only on CREATE: Postgres refuses it in ALTER from a non-superuser, even as
    // a no-op, and a role created without it can't gain it from the admin anyway.
    const attributes = `LOGIN NOCREATEDB NOCREATEROLE CONNECTION LIMIT ${CONNECTION_LIMIT} PASSWORD ${lit(password)}`
    await admin.query(
      roleExists
        ? `ALTER ROLE ${id(role)} ${attributes}`
        : `CREATE ROLE ${id(role)} NOSUPERUSER ${attributes}`,
    )
    await admin.query(`ALTER ROLE ${id(role)} SET statement_timeout = ${lit(STATEMENT_TIMEOUT)}`)
    await admin.query(
      `ALTER ROLE ${id(role)} SET idle_in_transaction_session_timeout = ${lit(IDLE_IN_TRANSACTION_TIMEOUT)}`,
    )
    // The admin may act as the app (to create what the app owns) without inheriting its rights.
    await admin.query(`GRANT ${id(role)} TO ${id(me)} WITH INHERIT FALSE, SET TRUE`)

    if (ownDatabase) {
      // The layout before ADR 0034: the app owns its database. Only it and the admin connect.
      await admin.query(`SET ROLE ${id(role)}`)
      await admin.query(`REVOKE ALL ON DATABASE ${id(role)} FROM PUBLIC`)
      await admin.query(`GRANT CONNECT, CREATE ON DATABASE ${id(role)} TO ${id(me)}`)
      await admin.query('RESET ROLE')
      return
    }
    await admin.query(`ALTER ROLE ${id(role)} SET search_path = ${id(role)}`)
    await admin.query(`GRANT ${id(where.group)} TO ${id(role)}`)
    await admin.query(`GRANT CONNECT ON DATABASE ${id(instance)} TO ${id(role)}`)
  })

  if (ownDatabase) return { database: role }
  await asAdmin(adminUrl, instance, (db) =>
    db.query(`CREATE SCHEMA IF NOT EXISTS ${id(role)} AUTHORIZATION ${id(role)}`),
  )
  return { database: instance }
}

/**
 * Drops an app's schema (with everything in it), its own database if it still has one, and its
 * role. Nothing happens for what doesn't exist.
 */
export async function purge(adminUrl: string, name: string, { database: instance } = INSTANCE) {
  const role = appRoleName(name)
  const found = await asAdmin(adminUrl, undefined, async (admin) => ({
    role: await exists(admin, 'SELECT 1 FROM pg_roles WHERE rolname = $1', role),
    instance: await exists(admin, 'SELECT 1 FROM pg_database WHERE datname = $1', instance),
  }))
  if (!found.role) return

  if (found.instance) {
    await asAdmin(adminUrl, instance, async (db) => {
      const me = await currentUser(db)
      await db.query(`GRANT ${id(role)} TO ${id(me)} WITH INHERIT FALSE, SET TRUE`)
      // As the app: drops its schema and anything else it owns here, and its grants here.
      await db.query(`SET ROLE ${id(role)}`)
      await db.query(`DROP OWNED BY ${id(role)} CASCADE`)
      await db.query('RESET ROLE')
      await db.query(`REVOKE ALL ON DATABASE ${id(instance)} FROM ${id(role)}`)
    })
  }

  await asAdmin(adminUrl, undefined, async (admin) => {
    const me = await currentUser(admin)
    await admin.query(`GRANT ${id(role)} TO ${id(me)} WITH INHERIT FALSE, SET TRUE`)
    // As the owner, which may drop its database and end its own open connections.
    await admin.query(`SET ROLE ${id(role)}`)
    await admin.query(`DROP DATABASE IF EXISTS ${id(role)} WITH (FORCE)`)
    await admin.query('RESET ROLE')
    await admin.query(`DROP ROLE ${id(role)}`)
  })
}
