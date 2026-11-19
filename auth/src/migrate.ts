import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'

const { escapeIdentifier: id } = pg

export interface Migration {
  version: number
  name: string
  sql: string
}

/** The SQL files in ./migrations, numbered by their prefix (`0001_auth.sql` is version 1). */
export function loadMigrations(dir = new URL('./migrations/', import.meta.url)): Migration[] {
  return readdirSync(dir)
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort()
    .map((file, index) => {
      const version = Number(file.slice(0, 4))
      if (version !== index + 1) throw new Error(`Migration ${file} is out of order`)
      return { version, name: file.slice(5, -4), sql: readFileSync(new URL(file, dir), 'utf8') }
    })
}

// Any constant works; it only has to be the same for every process migrating `auth`.
const LOCK = 4_250_816_002

/**
 * Brings the `auth` schema up to date, in one transaction, under an advisory lock so two
 * starting services wait for each other. Runs as the pool's role, which owns `auth`. Then
 * grants the app group what apps may use (ADR 0035): reading a few columns of `auth.users` and
 * pointing foreign keys at its id.
 */
export async function migrate(
  client: pg.ClientBase,
  appGroup: string,
  /** The agent's role, which lists and deletes users for the dashboard, if it exists. */
  adminRole?: string,
  migrations = loadMigrations(),
): Promise<{ from: number; to: number }> {
  await client.query('BEGIN')
  try {
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK])
    await client.query(`CREATE TABLE IF NOT EXISTS auth.migrations (
      version    integer PRIMARY KEY,
      name       text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
    const { rows } = await client.query<{ version: number }>(
      'SELECT coalesce(max(version), 0)::int AS version FROM auth.migrations',
    )
    const from = rows[0]?.version ?? 0
    const to = migrations.length
    if (from > to) {
      throw new Error(`The auth schema is at version ${from}, newer than this service's ${to}`)
    }
    for (const migration of migrations.slice(from)) {
      await client.query(migration.sql)
      await client.query('INSERT INTO auth.migrations (version, name) VALUES ($1, $2)', [
        migration.version,
        migration.name,
      ])
    }
    const group = id(appGroup)
    await client.query(`GRANT USAGE ON SCHEMA auth TO ${group}`)
    await client.query(
      `GRANT SELECT (id, is_anonymous, created_at, updated_at), REFERENCES (id) ON auth.users TO ${group}`,
    )
    // The dashboard's Pool page, through the agent: who is in the pool, and deleting someone
    // (their sessions and app rows go through the foreign keys' cascades).
    const admin = adminRole
      ? await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [adminRole])
      : undefined
    if (adminRole && admin?.rowCount) {
      await client.query(`GRANT USAGE ON SCHEMA auth TO ${id(adminRole)}`)
      await client.query(`GRANT SELECT ON auth.users, auth.sessions TO ${id(adminRole)}`)
      await client.query(`GRANT DELETE ON auth.users TO ${id(adminRole)}`)
    }
    await client.query('COMMIT')
    return { from, to }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
