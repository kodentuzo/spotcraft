// The real database code against a real Postgres (see packages/kit's tests): skipped
// without KIT_TEST_POSTGRES_URL locally, required in CI.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { Instance } from '@kodentuzo/spotcraft/provision'
import { migrate } from '@spotcraft/kit/provision'
import pg from 'pg'
import { AgentError } from '../src/apps.ts'
import { fillOrder, postgresDatabases } from '../src/databases.ts'

const SUPERUSER_URL = process.env.KIT_TEST_POSTGRES_URL
if (!SUPERUSER_URL && process.env.CI) throw new Error('KIT_TEST_POSTGRES_URL is not set')

const ADMIN = 'agent_test_admin'
const ADMIN_PASSWORD = 'agent-admin-password-0123456789'
// Its own instance database and group, so other packages' tests on the same server can't clash.
const INSTANCE: Instance = { database: 'agent_test_apps', group: 'agent_test_app' }
const PASSWORD = 'app-password-0123456789'

async function query(url: string, sql: string) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await client.query(sql)
  } finally {
    await client.end()
  }
}

describe('postgres app databases', {
  skip: !SUPERUSER_URL && 'KIT_TEST_POSTGRES_URL is not set',
}, () => {
  const urlFor = (user: string, password: string, database = 'postgres') => {
    const url = new URL(SUPERUSER_URL as string)
    url.username = user
    url.password = password
    url.pathname = `/${database}`
    return url.toString()
  }
  const adminUrl = () => urlFor(ADMIN, ADMIN_PASSWORD)
  const databases = () => postgresDatabases(adminUrl(), INSTANCE)

  async function cleanUp() {
    const su = SUPERUSER_URL as string
    await query(su, 'DROP DATABASE IF EXISTS app_agent_test WITH (FORCE)')
    await query(su, `DROP DATABASE IF EXISTS ${INSTANCE.database} WITH (FORCE)`)
    await query(su, 'DROP ROLE IF EXISTS app_agent_test')
    await query(su, `DROP ROLE IF EXISTS ${INSTANCE.group}`)
    await query(su, `DROP ROLE IF EXISTS ${ADMIN}`)
  }

  before(async () => {
    await cleanUp()
    await query(
      SUPERUSER_URL as string,
      `CREATE ROLE ${ADMIN} LOGIN CREATEDB CREATEROLE PASSWORD '${ADMIN_PASSWORD}'`,
    )
  })
  after(async () => {
    if (SUPERUSER_URL) await cleanUp()
  })

  it('gives an app its schema in the instance database, and purges it', async () => {
    const env = await databases().provision('agent-test', PASSWORD)
    assert.equal(env.DATABASE_SCHEMA, 'app_agent_test')
    const parsed = new URL(env.DATABASE_URL)
    assert.equal(parsed.username, 'app_agent_test')
    assert.equal(parsed.pathname, `/${INSTANCE.database}`)
    assert.equal(parsed.host, new URL(SUPERUSER_URL as string).host)

    const { rows } = await query(
      env.DATABASE_URL,
      'SELECT current_database() AS db, current_schema() AS schema, current_user AS me',
    )
    assert.deepEqual(rows[0], {
      db: INSTANCE.database,
      schema: 'app_agent_test',
      me: 'app_agent_test',
    })
    assert.deepEqual(await databases().dumpTarget('agent-test'), {
      database: INSTANCE.database,
      schema: 'app_agent_test',
    })
    // No user pool has set up `auth` here yet.
    assert.deepEqual(await databases().listUsers({ limit: 2 }), {
      available: false,
      total: 0,
      guests: 0,
      users: [],
    })

    await databases().purge('agent-test')
    const left = await query(
      urlFor(ADMIN, ADMIN_PASSWORD, INSTANCE.database),
      `SELECT nspname AS name FROM pg_namespace WHERE nspname = 'app_agent_test'
       UNION ALL SELECT rolname FROM pg_roles WHERE rolname = 'app_agent_test'`,
    )
    assert.equal(left.rowCount, 0)
    await assert.rejects(query(env.DATABASE_URL, 'SELECT 1'), /password authentication failed/)
  })

  it('keeps an app made before ADR 0034 in its own database', async () => {
    // Its own role and database, made by the agent.
    await query(adminUrl(), `CREATE ROLE app_agent_test LOGIN PASSWORD '${PASSWORD}'`)
    await query(adminUrl(), `GRANT app_agent_test TO ${ADMIN} WITH INHERIT FALSE, SET TRUE`)
    await query(adminUrl(), 'CREATE DATABASE app_agent_test OWNER app_agent_test')
    const env = await databases().provision('agent-test', PASSWORD)
    assert.equal(env.DATABASE_SCHEMA, undefined, 'it keeps its own database')
    assert.equal(new URL(env.DATABASE_URL).pathname, '/app_agent_test')
    assert.deepEqual(await databases().dumpTarget('agent-test'), { database: 'app_agent_test' })
    await databases().purge('agent-test')
    const left = await query(
      SUPERUSER_URL as string,
      `SELECT 1 FROM pg_database WHERE datname = 'app_agent_test'`,
    )
    assert.equal(left.rowCount, 0)
  })

  it("lists the pool's users newest first, page by page, and deletes with cascades", async () => {
    const databases = postgresDatabases(adminUrl(), INSTANCE)
    const app = await databases.provision('agent-test', PASSWORD)
    // The pool's `auth`, as the auth service sets it up: the kit's tables have the same shape.
    const pool = new URL(SUPERUSER_URL as string)
    pool.pathname = `/${INSTANCE.database}`
    await migrate(pool.toString())
    await query(
      pool.toString(),
      `GRANT USAGE ON SCHEMA auth TO ${INSTANCE.group}, ${ADMIN};
       GRANT SELECT (id, is_anonymous, created_at, updated_at), REFERENCES (id) ON auth.users TO ${INSTANCE.group};
       GRANT SELECT ON auth.users, auth.sessions TO ${ADMIN};
       GRANT DELETE ON auth.users TO ${ADMIN};`,
    )
    // An app's own table, pointing at its users.
    await query(
      app.DATABASE_URL,
      `CREATE TABLE notes (
         id serial PRIMARY KEY,
         user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
         body text NOT NULL)`,
    )
    // Three users a minute apart: a registered one and two guests, one with sessions.
    const { rows: made } = await query(
      pool.toString(),
      `INSERT INTO auth.users (email, is_anonymous, created_at) VALUES
         ('member@example.test', false, now() - interval '3 minutes'),
         ('guest-1@example.test', true, now() - interval '2 minutes'),
         ('guest-2@example.test', true, now() - interval '1 minute')
       RETURNING id, email`,
    )
    const idOf = (email: string) => made.find((row) => row.email === email)?.id as string
    await query(
      pool.toString(),
      `INSERT INTO auth.sessions (user_id, token, expires_at, updated_at) VALUES
         ('${idOf('guest-1@example.test')}', 't1', now() + interval '1 day', now() - interval '30 seconds'),
         ('${idOf('guest-1@example.test')}', 't2', now() + interval '1 day', now() - interval '90 seconds')`,
    )
    await query(
      app.DATABASE_URL,
      `INSERT INTO notes (user_id, body) VALUES ('${idOf('guest-1@example.test')}', 'hi')`,
    )

    const first = await databases.listUsers({ limit: 2 })
    assert.equal(first.available, true)
    assert.equal(first.total, 3)
    assert.equal(first.guests, 2)
    assert.deepEqual(
      first.users.map((u) => [u.id, u.guest]),
      [
        [idOf('guest-2@example.test'), true],
        [idOf('guest-1@example.test'), true],
      ],
    )
    assert.equal(first.users[0].lastSeen, null, 'no session')
    const seen = Date.parse(first.users[1].lastSeen ?? '')
    assert.ok(Date.now() - seen < 60_000, 'the most recent of their sessions')
    assert.ok(first.next)

    const second = await databases.listUsers({ limit: 2, cursor: first.next })
    assert.deepEqual(
      second.users.map((u) => [u.id, u.guest]),
      [[idOf('member@example.test'), false]],
    )
    assert.equal(second.next, undefined)
    await assert.rejects(
      databases.listUsers({ limit: 2, cursor: 'bm9wZQ' }),
      (error: unknown) => error instanceof AgentError && error.statusCode === 400,
    )

    assert.equal(await databases.deleteUser(idOf('guest-1@example.test')), true)
    assert.equal(await databases.deleteUser(idOf('guest-1@example.test')), false)
    const left = await query(
      pool.toString(),
      `SELECT (SELECT count(*) FROM auth.sessions)::int AS sessions,
              (SELECT count(*) FROM app_agent_test.notes)::int AS notes`,
    )
    assert.deepEqual(left.rows[0], { sessions: 0, notes: 0 })
    assert.equal((await databases.listUsers({ limit: 10 })).total, 2)
    await databases.purge('agent-test')
  })

  it("counts an app's accounts from the hosts of their sessions, and only counts", async () => {
    const databases = postgresDatabases(adminUrl(), INSTANCE)
    const pool = new URL(SUPERUSER_URL as string)
    pool.pathname = `/${INSTANCE.database}`
    await migrate(pool.toString())
    await query(
      pool.toString(),
      `GRANT USAGE ON SCHEMA auth TO ${ADMIN};
       GRANT SELECT ON auth.users, auth.sessions TO ${ADMIN};`,
    )
    // Before the pool records hosts, there's nothing to count.
    assert.equal(await databases.accountUsage(['blog.example.test']), undefined)
    // The auth service's migration 0004, on the kit's tables of the same shape.
    await query(
      pool.toString(),
      `ALTER TABLE auth.sessions ADD COLUMN IF NOT EXISTS host text;
       ALTER TABLE auth.sessions ADD COLUMN IF NOT EXISTS client text;
       DELETE FROM auth.users;`,
    )
    const { rows: users } = await query(
      pool.toString(),
      `INSERT INTO auth.users (email, is_anonymous)
       SELECT 'u' || n || '@example.test', true FROM generate_series(1, 4) n RETURNING id`,
    )
    const [a, b, c, d] = users.map((row) => row.id as string)
    // a: on the blog today, from iOS; b: a week ago, on its custom domain, Android; c: on the
    // blog 3 weeks ago; d: only on another app.
    await query(
      pool.toString(),
      `INSERT INTO auth.sessions (user_id, token, expires_at, created_at, updated_at, host, client) VALUES
         ('${a}', 'a1', now() + interval '1 year', now() - interval '2 days', now() - interval '1 hour', 'blog.example.test', 'ios/1.4.0'),
         ('${a}', 'a2', now() + interval '1 year', now() - interval '1 hour', now() - interval '1 hour', 'blog.example.test', 'ios/1.4.0'),
         ('${b}', 'b1', now() + interval '1 year', now() - interval '6 days', now() - interval '5 days', 'blog.test', 'android/1.3.0'),
         ('${c}', 'c1', now() + interval '1 year', now() - interval '21 days', now() - interval '20 days', 'blog.example.test', null),
         ('${d}', 'd1', now() + interval '1 year', now() - interval '1 hour', now() - interval '1 hour', 'shop.example.test', 'ios/1.4.0')`,
    )
    const usage = await databases.accountUsage(['blog.example.test', 'blog.test'])
    assert.deepEqual(usage?.active, { day: 1, week: 2, month: 3 })
    assert.equal(
      usage?.newPerDay.reduce((sum, day) => sum + day.count, 0),
      3,
      'one per account, on its first day',
    )
    assert.ok(usage?.newPerDay.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.day)))
    assert.deepEqual(usage?.clients, [
      { client: 'android/1.3.0', active: 1 },
      { client: 'ios/1.4.0', active: 1 },
    ])
    await query(pool.toString(), 'DELETE FROM auth.users')
  })
  it("moves a kit app's guests, sessions and rows from its own database into its schema", async () => {
    const su = SUPERUSER_URL as string
    // The app before ADR 0034: its own database, the kit's `auth` in it, its tables in public.
    await query(adminUrl(), `CREATE ROLE app_agent_test LOGIN PASSWORD '${PASSWORD}'`)
    await query(adminUrl(), `GRANT app_agent_test TO ${ADMIN} WITH INHERIT FALSE, SET TRUE`)
    await query(adminUrl(), 'CREATE DATABASE app_agent_test OWNER app_agent_test')
    const own = urlFor('app_agent_test', PASSWORD, 'app_agent_test')
    await migrate(own)
    const guest = (
      await query(
        own,
        `INSERT INTO auth.users (email, is_anonymous) VALUES ('temp@guest.example.test', true)
         RETURNING id`,
      )
    ).rows[0].id
    await query(
      own,
      `INSERT INTO auth.sessions (user_id, token, expires_at) VALUES
         ('${guest}', 'live-token', now() + interval '1 day'),
         ('${guest}', 'old-token', now() - interval '1 day');
       CREATE TABLE levels (id text PRIMARY KEY, title text NOT NULL);
       CREATE TABLE progress (
         user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
         level_id text NOT NULL REFERENCES levels (id),
         moves int NOT NULL,
         dropped_later text);
       CREATE TABLE counters (id serial PRIMARY KEY, n int NOT NULL);
       CREATE TABLE journal (id int PRIMARY KEY);
       INSERT INTO levels VALUES ('one', 'One'), ('two', 'Two');
       INSERT INTO progress VALUES ('${guest}', 'two', 12, 'x');
       INSERT INTO counters (n) VALUES (10), (20);
       INSERT INTO journal VALUES (1), (2);`,
    )

    // The pool's `auth` in the instance database, as the auth service sets it up.
    const env = await databases().provision('agent-test', PASSWORD, { move: true })
    assert.equal(env.DATABASE_SCHEMA, 'app_agent_test')
    const pool = new URL(su)
    pool.pathname = `/${INSTANCE.database}`
    await migrate(pool.toString())
    await query(
      pool.toString(),
      `CREATE TABLE IF NOT EXISTS auth.former_secrets (
         secret text PRIMARY KEY, app text NOT NULL, added_at timestamptz NOT NULL DEFAULT now());
       GRANT USAGE ON SCHEMA auth TO ${INSTANCE.group}, ${ADMIN};
       GRANT SELECT (id, is_anonymous, created_at, updated_at), REFERENCES (id) ON auth.users TO ${INSTANCE.group};
       GRANT SELECT ON auth.users, auth.sessions TO ${ADMIN};
       GRANT INSERT ON auth.users, auth.sessions, auth.former_secrets TO ${ADMIN};`,
    )
    // The new version's migrations: the same tables in its schema, less one column; it fills
    // its journal itself.
    await query(
      env.DATABASE_URL,
      `CREATE TABLE levels (id text PRIMARY KEY, title text NOT NULL);
       CREATE TABLE progress (
         user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
         level_id text NOT NULL REFERENCES levels (id),
         moves int NOT NULL);
       CREATE TABLE counters (id serial PRIMARY KEY, n int NOT NULL);
       CREATE TABLE journal (id int PRIMARY KEY);
       INSERT INTO journal VALUES (1);`,
    )
    assert.equal(
      (await query(own, 'SELECT count(*)::int AS n FROM levels')).rows[0].n,
      2,
      'the old version still finds its tables while it moves',
    )

    const moved = await databases().move('agent-test', { formerSecret: 'the-kit-secret' })
    assert.deepEqual(moved, {
      users: 1,
      sessions: 1,
      tables: { counters: 2, levels: 2, progress: 1 },
    })
    const after = await query(
      env.DATABASE_URL,
      `SELECT (SELECT count(*) FROM journal)::int AS journal,
              (SELECT moves FROM progress WHERE user_id = '${guest}') AS moves`,
    )
    assert.deepEqual(after.rows[0], { journal: 1, moves: 12 })
    const next = await query(env.DATABASE_URL, 'INSERT INTO counters (n) VALUES (30) RETURNING id')
    assert.equal(next.rows[0].id, 3, 'the serial continues after the moved rows')
    const sessions = await query(pool.toString(), 'SELECT token FROM auth.sessions')
    assert.deepEqual(
      sessions.rows.map((row) => row.token),
      ['live-token'],
    )
    const former = await query(pool.toString(), 'SELECT secret, app FROM auth.former_secrets')
    assert.deepEqual(former.rows, [{ secret: 'the-kit-secret', app: 'agent-test' }])
    assert.equal(await databases().layout('agent-test'), 'schema', 'the schema wins now')
    assert.deepEqual(await databases().dumpTarget('agent-test'), {
      database: INSTANCE.database,
      schema: 'app_agent_test',
    })

    // Moving again copies nothing twice.
    assert.deepEqual(await databases().move('agent-test', {}), {
      users: 0,
      sessions: 0,
      tables: {},
    })

    await databases().dropSchema('agent-test')
    assert.equal(await databases().layout('agent-test'), 'database', 'back where it was')
    await query(pool.toString(), 'DELETE FROM auth.users; DELETE FROM auth.former_secrets')
    await databases().purge('agent-test')
  })

  it('fills tables after those their foreign keys point at', () => {
    assert.deepEqual(
      fillOrder(
        ['s.progress', 's.levels', 's.packs', 's.tree'],
        [
          ['s.progress', 's.levels'],
          ['s.levels', 's.packs'],
          ['s.tree', 's.tree'],
          ['s.progress', 'auth.users'],
        ],
      ),
      ['s.packs', 's.tree', 's.levels', 's.progress'],
    )
    assert.throws(
      () =>
        fillOrder(
          ['s.a', 's.b'],
          [
            ['s.a', 's.b'],
            ['s.b', 's.a'],
          ],
        ),
      /round in a circle/,
    )
  })
})
