import {
  appLayout,
  appRoleName,
  INSTANCE,
  type Instance,
  provision,
  purge,
} from '@kodentuzo/spotcraft/provision'
import pg from 'pg'
import { AgentError, type Databases, type PoolUser } from './apps.ts'

/** Keyset cursor for user pages: the last row's creation time and id. */
const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url')

function decodeCursor(cursor: string): [string, string] {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString().split('|')
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) {
    throw new AgentError('Invalid cursor', 400)
  }
  return [createdAt, id]
}

/** Where `pg_dump` finds one app: a schema of the instance database, or its own database. */
export interface DumpTarget {
  database: string
  schema?: string
}

/**
 * App schemas on the server's Postgres, managed as the agent's role (`adminUrl`, e.g.
 * `postgres://spotcraft_agent:…@postgres:5432/postgres`). Apps reach the same server by the
 * same host name, on the network they share with it. Apps made before ADR 0034 keep their own
 * database until they move.
 */
export function postgresDatabases(
  adminUrl: string,
  /** Where apps live; another one only keeps tests apart. */
  instance: Instance = INSTANCE,
): Databases & {
  dumpTarget(name: string): Promise<DumpTarget>
} {
  const urlFor = (database: string, user?: { name: string; password: string }) => {
    const url = new URL(adminUrl)
    if (user) {
      url.username = user.name
      url.password = user.password
    }
    url.pathname = `/${database}`
    url.search = ''
    return url.toString()
  }

  /**
   * Runs `fn` connected as the agent to the instance database, where the user pool keeps its
   * `auth` schema and lets the agent read users and sessions and delete users. Apps own schemas
   * there; every query here is qualified, and a fixed search_path keeps anything an app made
   * from shadowing what they resolve to. Set as a startup option, so there is no extra query
   * that could fail after connecting.
   */
  async function inPool<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({
      connectionString: urlFor(instance.database),
      options: '-c search_path=pg_catalog,auth',
    })
    await client.connect()
    try {
      return await fn(client)
    } finally {
      await client.end()
    }
  }

  return {
    async provision(name, password) {
      const { database } = await provision(adminUrl, { name, password, instance })
      const role = appRoleName(name)
      const env: Record<string, string> = {
        DATABASE_URL: urlFor(database, { name: role, password }),
      }
      if (database === instance.database) env.DATABASE_SCHEMA = role
      return env
    },

    async dumpTarget(name) {
      const role = appRoleName(name)
      return (await appLayout(adminUrl, name, instance)) === 'database'
        ? { database: role }
        : { database: instance.database, schema: role }
    },

    purge: (name) => purge(adminUrl, name, instance),

    listUsers: ({ limit, cursor }) =>
      inPool(async (db) => {
        const found = await db.query<{ ok: boolean }>(
          `SELECT to_regclass('auth.users') IS NOT NULL
             AND has_table_privilege('auth.users', 'SELECT')
             AND has_table_privilege('auth.sessions', 'SELECT') AS ok`,
        )
        if (!found.rows[0]?.ok) return { available: false, total: 0, guests: 0, users: [] }
        const after = cursor ? decodeCursor(cursor) : null
        const { rows } = await db.query<{
          id: string
          is_anonymous: boolean
          created_at: Date
          last_seen: Date | null
        }>(
          `SELECT u.id, u.is_anonymous, u.created_at, max(s.updated_at) AS last_seen
           FROM auth.users u LEFT JOIN auth.sessions s ON s.user_id = u.id
           WHERE $1::timestamptz IS NULL OR (u.created_at, u.id) < ($1::timestamptz, $2::uuid)
           GROUP BY u.id
           ORDER BY u.created_at DESC, u.id DESC
           LIMIT $3`,
          [after?.[0] ?? null, after?.[1] ?? null, limit + 1],
        )
        const counts = await db.query<{ total: number; guests: number }>(
          'SELECT count(*)::int AS total, count(*) FILTER (WHERE is_anonymous)::int AS guests FROM auth.users',
        )
        const page = rows.slice(0, limit)
        const users: PoolUser[] = page.map((row) => ({
          id: row.id,
          guest: row.is_anonymous,
          createdAt: row.created_at.toISOString(),
          lastSeen: row.last_seen?.toISOString() ?? null,
        }))
        const last = page.at(-1)
        return {
          available: true,
          total: counts.rows[0]?.total ?? 0,
          guests: counts.rows[0]?.guests ?? 0,
          users,
          ...(rows.length > limit && last ? { next: encodeCursor(last.created_at, last.id) } : {}),
        }
      }),

    deleteUser: (id) =>
      inPool(async (db) => {
        // Sessions, accounts and every app's rows go through their foreign-key cascades.
        const deleted = await db.query('DELETE FROM auth.users WHERE id = $1', [id])
        return (deleted.rowCount ?? 0) > 0
      }),
  }
}
