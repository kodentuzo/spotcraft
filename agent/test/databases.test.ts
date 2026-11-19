// The real database code against a real Postgres (see packages/kit's tests): skipped
// without KIT_TEST_POSTGRES_URL locally, required in CI.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { migrate } from '@spotcraft/kit/provision'
import pg from 'pg'
import type { Instance } from 'spotcraft/provision'
import { AgentError } from '../src/apps.ts'
import { postgresDatabases } from '../src/databases.ts'

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
    // Its users are the instance's (ADR 0035), not in tables of its own.
    assert.deepEqual(await databases().listUsers('agent-test', { limit: 2 }), {
      available: false,
      total: 0,
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

  /**
   * An app made before ADR 0034: its own role and database, made by the agent, with the kit's
   * `auth` schema owned by the agent.
   */
  async function addOldApp(): Promise<string> {
    await query(adminUrl(), `CREATE ROLE app_agent_test LOGIN PASSWORD '${PASSWORD}'`)
    await query(adminUrl(), `GRANT app_agent_test TO ${ADMIN} WITH INHERIT FALSE, SET TRUE`)
    await query(adminUrl(), 'CREATE DATABASE app_agent_test OWNER app_agent_test')
    const env = await databases().provision('agent-test', PASSWORD)
    assert.equal(env.DATABASE_SCHEMA, undefined, 'it keeps its own database')
    assert.equal(new URL(env.DATABASE_URL).pathname, '/app_agent_test')
    const asAgent = urlFor(ADMIN, ADMIN_PASSWORD, 'app_agent_test')
    await migrate(asAgent)
    await query(asAgent, 'GRANT USAGE ON SCHEMA auth TO app_agent_test')
    await query(
      asAgent,
      'GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON ALL TABLES IN SCHEMA auth TO app_agent_test',
    )
    return env.DATABASE_URL
  }

  it("lists an app's users newest first, page by page, and deletes with cascades", async () => {
    const databases = postgresDatabases(adminUrl(), INSTANCE)
    const url = await addOldApp()
    assert.deepEqual(await databases.dumpTarget('agent-test'), { database: 'app_agent_test' })
    // Three users a minute apart: a registered one and two guests, one with an old session.
    await query(
      url,
      `CREATE TABLE public.notes (
      id serial PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
      body text NOT NULL)`,
    )
    const { rows: made } = await query(
      url,
      `INSERT INTO auth.users (email, is_anonymous, created_at) VALUES
         ('member@example.test', false, now() - interval '3 minutes'),
         ('guest-1@example.test', true, now() - interval '2 minutes'),
         ('guest-2@example.test', true, now() - interval '1 minute')
       RETURNING id, email`,
    )
    const idOf = (email: string) => made.find((row) => row.email === email)?.id as string
    await query(
      url,
      `INSERT INTO auth.sessions (user_id, token, expires_at, updated_at) VALUES
         ('${idOf('guest-1@example.test')}', 't1', now() + interval '1 day', now() - interval '30 seconds'),
         ('${idOf('guest-1@example.test')}', 't2', now() + interval '1 day', now() - interval '90 seconds')`,
    )
    await query(
      url,
      `INSERT INTO public.notes (user_id, body) VALUES ('${idOf('guest-1@example.test')}', 'hi')`,
    )

    const first = await databases.listUsers('agent-test', { limit: 2 })
    assert.equal(first.available, true)
    assert.equal(first.total, 3)
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

    const second = await databases.listUsers('agent-test', { limit: 2, cursor: first.next })
    assert.deepEqual(
      second.users.map((u) => [u.id, u.guest]),
      [[idOf('member@example.test'), false]],
    )
    assert.equal(second.next, undefined)
    await assert.rejects(
      databases.listUsers('agent-test', { limit: 2, cursor: 'bm9wZQ' }),
      (error: unknown) => error instanceof AgentError && error.statusCode === 400,
    )

    assert.equal(await databases.deleteUser('agent-test', idOf('guest-1@example.test')), true)
    assert.equal(await databases.deleteUser('agent-test', idOf('guest-1@example.test')), false)
    const left = await query(
      url,
      `SELECT (SELECT count(*) FROM auth.sessions)::int AS sessions, (SELECT count(*) FROM public.notes)::int AS notes`,
    )
    assert.deepEqual(left.rows[0], { sessions: 0, notes: 0 })
    assert.equal((await databases.listUsers('agent-test', { limit: 10 })).total, 2)
    await databases.purge('agent-test')
  })
})
