import {
  appLayout,
  appRoleName,
  dropSchema,
  INSTANCE,
  type Instance,
  provision,
  purge,
} from '@kodentuzo/spotcraft/provision'
import pg from 'pg'
import { AgentError, type Databases, type Moved, type PoolUser } from './apps.ts'

const { escapeIdentifier: id } = pg

/** The columns of the kit's `auth` tables that the pool's have too (ADRs 0016 and 0035). */
const USER_COLUMNS = [
  'id',
  'name',
  'email',
  'email_verified',
  'image',
  'is_anonymous',
  'created_at',
  'updated_at',
]
const SESSION_COLUMNS = [
  'id',
  'user_id',
  'token',
  'expires_at',
  'ip_address',
  'user_agent',
  'created_at',
  'updated_at',
]

/**
 * Tables in the order they can be filled: each after the tables its foreign keys point at.
 * `edges` are [table, referenced table]; references outside `tables` don't count.
 */
export function fillOrder(tables: string[], edges: [string, string][]): string[] {
  const order: string[] = []
  const left = new Set(tables)
  while (left.size) {
    const ready = [...left].filter((table) =>
      edges.every(([from, to]) => from !== table || to === table || !left.has(to)),
    )
    if (!ready.length) throw new Error(`Foreign keys go round in a circle: ${[...left].join(', ')}`)
    for (const table of ready.sort()) {
      order.push(table)
      left.delete(table)
    }
  }
  return order
}

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
    async provision(name, password, { move = false } = {}) {
      const { database } = await provision(adminUrl, { name, password, instance, move })
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

    layout: (name) => appLayout(adminUrl, name, instance),

    dropSchema: (name) => dropSchema(adminUrl, name, instance),

    async move(name, { formerSecret }) {
      const role = appRoleName(name)
      // The old database, read as the app (which owns everything in it).
      const from = new pg.Client({ connectionString: urlFor(role) })
      await from.connect()
      try {
        await from.query(`SET ROLE ${id(role)}`)
        const read = async (sql: string) =>
          (
            await from.query<{ rows: unknown[] }>(
              `SELECT coalesce(json_agg(t), '[]') AS rows FROM (${sql}) t`,
            )
          ).rows[0].rows
        const hasAuth = (await from.query("SELECT to_regclass('auth.sessions') IS NOT NULL AS ok"))
          .rows[0].ok
        const users = hasAuth ? await read(`SELECT ${USER_COLUMNS.join(', ')} FROM auth.users`) : []
        // Expired sessions would only be deleted again.
        const sessions = hasAuth
          ? await read(
              `SELECT ${SESSION_COLUMNS.join(', ')} FROM auth.sessions WHERE expires_at > now()`,
            )
          : []
        const tables = (
          await from.query<{ name: string }>(
            `SELECT relname AS name FROM pg_class
             WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')`,
          )
        ).rows.map((row) => row.name)

        return await inPool(async (to) => {
          await to.query('BEGIN')
          try {
            const fill = async (table: string, columns: string[], rows: unknown[]) => {
              if (!rows.length) return 0
              const list = columns.map(id).join(', ')
              const inserted = await to.query(
                `INSERT INTO ${table} (${list}) OVERRIDING SYSTEM VALUE
                 SELECT ${list} FROM json_populate_recordset(NULL::${table}, $1)
                 ON CONFLICT DO NOTHING`,
                [JSON.stringify(rows)],
              )
              return inserted.rowCount ?? 0
            }
            // The guests first, with the same ids and tokens, so their cookies stay valid.
            const moved: Moved = {
              users: await fill('auth.users', USER_COLUMNS, users),
              sessions: await fill('auth.sessions', SESSION_COLUMNS, sessions),
              tables: {},
            }
            if (formerSecret) {
              await to.query(
                'INSERT INTO auth.former_secrets (secret, app) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [formerSecret, name],
              )
            }
            // Then the app's rows, as the app: into each table the new version made and left
            // empty (a table it filled itself, like a migrations journal, is its own).
            await to.query(`SET LOCAL ROLE ${id(role)}`)
            const made = await to.query<{ name: string; columns: string[] }>(
              `SELECT c.relname AS name,
                      array_agg(a.attname::text ORDER BY a.attnum) FILTER (WHERE a.attgenerated = '') AS columns
               FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
               WHERE c.relnamespace = $1::regnamespace AND c.relkind IN ('r', 'p') AND c.relname = ANY($2)
               GROUP BY c.relname`,
              [role, tables],
            )
            const edges = await to.query<{ from: string; to: string }>(
              `SELECT conrelid::regclass::text AS from, confrelid::regclass::text AS to
               FROM pg_constraint WHERE contype = 'f' AND connamespace = $1::regnamespace`,
              [role],
            )
            const qualified = (table: string) => `${id(role)}.${id(table)}`
            const columnsOf = new Map(made.rows.map((row) => [qualified(row.name), row]))
            for (const table of fillOrder(
              [...columnsOf.keys()],
              edges.rows.map((edge) => [edge.from, edge.to]),
            )) {
              const target = columnsOf.get(table) as { name: string; columns: string[] }
              const empty = await to.query(`SELECT NOT EXISTS (SELECT FROM ${table}) AS empty`)
              if (!empty.rows[0].empty) continue
              const source = await from.query<{ name: string }>(
                `SELECT attname AS name FROM pg_attribute
                 WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped`,
                [`public.${id(target.name)}`],
              )
              const shared = target.columns.filter((column) =>
                source.rows.some((row) => row.name === column),
              )
              const rows = await read(
                `SELECT ${shared.map(id).join(', ')} FROM public.${id(target.name)}`,
              )
              moved.tables[target.name] = await fill(table, shared, rows)
              // Serial and identity columns continue after the rows that came along.
              const serials = await to.query<{ column: string; seq: string }>(
                `SELECT name AS column, pg_get_serial_sequence($1, name) AS seq
                 FROM unnest($2::text[]) AS name WHERE pg_get_serial_sequence($1, name) IS NOT NULL`,
                [table, shared],
              )
              for (const { column, seq } of serials.rows) {
                await to.query(
                  `SELECT setval($1, coalesce((SELECT max(${id(column)}) FROM ${table}), 0) + 1, false)`,
                  [seq],
                )
              }
            }
            await to.query('COMMIT')
            return moved
          } catch (error) {
            await to.query('ROLLBACK')
            throw error
          }
        })
      } finally {
        await from.end()
      }
    },

    accountUsage: (hosts = null) =>
      inPool(async (db) => {
        const found = await db.query<{ ok: boolean }>(
          `SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'auth'
             AND table_name = 'sessions' AND column_name = 'host') AS ok`,
        )
        if (!found.rows[0]?.ok) return undefined
        const active = await db.query<{ day: number; week: number; month: number }>(
          `SELECT count(DISTINCT user_id) FILTER (WHERE updated_at > now() - interval '1 day')::int AS day,
                  count(DISTINCT user_id) FILTER (WHERE updated_at > now() - interval '7 days')::int AS week,
                  count(DISTINCT user_id)::int AS month
           FROM auth.sessions WHERE ($1::text[] IS NULL OR host = ANY($1))
             AND updated_at > now() - interval '30 days'`,
          [hosts],
        )
        const fresh = await db.query<{ day: Date; count: number }>(
          `SELECT date_trunc('day', first, 'UTC') AS day, count(*)::int AS count
           FROM (SELECT min(created_at) AS first FROM auth.sessions
                 WHERE $1::text[] IS NULL OR host = ANY($1) GROUP BY user_id) firsts
           WHERE first > now() - interval '30 days'
           GROUP BY 1 ORDER BY 1`,
          [hosts],
        )
        const clients = await db.query<{ client: string; active: number }>(
          `SELECT client, count(DISTINCT user_id)::int AS active FROM auth.sessions
           WHERE ($1::text[] IS NULL OR host = ANY($1)) AND client IS NOT NULL
             AND updated_at > now() - interval '30 days'
           GROUP BY client ORDER BY 2 DESC, 1 LIMIT 20`,
          [hosts],
        )
        return {
          active: active.rows[0] ?? { day: 0, week: 0, month: 0 },
          newPerDay: fresh.rows.map((row) => ({
            day: row.day.toISOString().slice(0, 10),
            count: row.count,
          })),
          clients: clients.rows,
        }
      }),
    listUsers: ({ limit, cursor, hosts = null }) =>
      inPool(async (db) => {
        const found = await db.query<{ ok: boolean }>(
          `SELECT to_regclass('auth.users') IS NOT NULL
             AND has_table_privilege('auth.users', 'SELECT')
             AND has_table_privilege('auth.sessions', 'SELECT') AS ok`,
        )
        if (!found.rows[0]?.ok) return { available: false, total: 0, guests: 0, users: [] }
        // For one app: the users with a session on its hosts, which the pool records from
        // migration 0004 on. Before that, there's no one to list for an app.
        if (hosts) {
          const recorded = await db.query<{ ok: boolean }>(
            `SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'auth'
               AND table_name = 'sessions' AND column_name = 'host') AS ok`,
          )
          if (!recorded.rows[0]?.ok) return { available: true, total: 0, guests: 0, users: [] }
        }
        // Only with hosts does the SQL name `host`: a pool from before 0004 has no such column,
        // and Postgres refuses a query that names one, whether or not it would be used.
        const onHosts = (p: string) =>
          hosts
            ? `EXISTS (SELECT FROM auth.sessions h WHERE h.user_id = u.id AND h.host = ANY(${p}))`
            : 'true'
        const after = cursor ? decodeCursor(cursor) : null
        const { rows } = await db.query<{
          id: string
          is_anonymous: boolean
          created_at: Date
          last_seen: Date | null
        }>(
          `SELECT u.id, u.is_anonymous, u.created_at, max(s.updated_at) AS last_seen
           FROM auth.users u
           -- For one app, last seen there: only its hosts' sessions.
           LEFT JOIN auth.sessions s ON s.user_id = u.id${hosts ? ' AND s.host = ANY($4)' : ''}
           WHERE ($1::timestamptz IS NULL OR (u.created_at, u.id) < ($1::timestamptz, $2::uuid))
             AND ${onHosts('$4')}
           GROUP BY u.id
           ORDER BY u.created_at DESC, u.id DESC
           LIMIT $3`,
          [after?.[0] ?? null, after?.[1] ?? null, limit + 1, ...(hosts ? [hosts] : [])],
        )
        const counts = await db.query<{ total: number; guests: number }>(
          `SELECT count(*)::int AS total, count(*) FILTER (WHERE is_anonymous)::int AS guests
           FROM auth.users u WHERE ${onHosts('$1')}`,
          hosts ? [hosts] : [],
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
