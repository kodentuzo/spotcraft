// Runs against a real Postgres. KIT_TEST_POSTGRES_URL is a superuser URL for a throwaway
// server (CI starts one); without it these tests are skipped locally and fail in CI.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import pg from 'pg'
import { appLayout, appRoleName, type Instance, provision, purge } from '../src/provision.ts'

const SUPERUSER_URL = process.env.KIT_TEST_POSTGRES_URL
if (!SUPERUSER_URL && process.env.CI) throw new Error('KIT_TEST_POSTGRES_URL is not set')

const ADMIN = 'cli_test_admin'
const ADMIN_PASSWORD = 'admin-password-0123456789'
// Its own instance database and group, so other packages' tests on the same server can't clash.
const INSTANCE: Instance = { database: 'cli_test_apps', group: 'cli_test_app' }
const APPS = ['cli-a', 'cli-b', 'cli-old']
const pw = (name: string, n = 1) => `${name}-password-${n}-0123456789`

/** The URL of the same server with another user and database. */
function urlFor(user: string, password: string, database = 'postgres') {
  const url = new URL(SUPERUSER_URL as string)
  url.username = user
  url.password = password
  url.pathname = `/${database}`
  return url.toString()
}
const adminUrl = () => urlFor(ADMIN, ADMIN_PASSWORD)
const appUrl = (name: string, password = pw(name)) =>
  urlFor(appRoleName(name), password, INSTANCE.database)
const options = (name: string, n = 1) => ({ name, password: pw(name, n), instance: INSTANCE })

async function query<T extends pg.QueryResultRow>(url: string, sql: string) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await client.query<T>(sql)
  } finally {
    await client.end()
  }
}

/** The error message a statement fails with, or undefined if it succeeds. */
async function failure(url: string, sql: string): Promise<string | undefined> {
  try {
    await query(url, sql)
    return undefined
  } catch (error) {
    return (error as Error).message
  }
}

describe('provisioning', { skip: !SUPERUSER_URL && 'KIT_TEST_POSTGRES_URL is not set' }, () => {
  const su = () => SUPERUSER_URL as string
  /** The instance database as the superuser, standing in for the user pool. */
  const pool = () => {
    const url = new URL(su())
    url.pathname = `/${INSTANCE.database}`
    return url.toString()
  }

  async function cleanUp() {
    for (const name of APPS) {
      await query(su(), `DROP DATABASE IF EXISTS ${appRoleName(name)} WITH (FORCE)`)
    }
    await query(su(), `DROP DATABASE IF EXISTS ${INSTANCE.database} WITH (FORCE)`)
    for (const name of APPS) await query(su(), `DROP ROLE IF EXISTS ${appRoleName(name)}`)
    await query(su(), `DROP ROLE IF EXISTS ${INSTANCE.group}`)
    await query(su(), `DROP ROLE IF EXISTS ${ADMIN}`)
  }

  before(async () => {
    await cleanUp()
    // Like the server's spotcraft_agent, but without its createrole_self_grant setting:
    // provision must not depend on it.
    await query(su(), `CREATE ROLE ${ADMIN} LOGIN CREATEDB CREATEROLE PASSWORD '${ADMIN_PASSWORD}'`)
  })

  after(async () => {
    if (SUPERUSER_URL) await cleanUp()
  })

  it('provisions a schema the app owns, and running it again changes nothing', async () => {
    for (const name of ['cli-a', 'cli-b']) {
      assert.deepEqual(await provision(adminUrl(), options(name)), {
        database: INSTANCE.database,
      })
    }
    await provision(adminUrl(), options('cli-a'))
    assert.equal(await appLayout(adminUrl(), 'cli-a', INSTANCE), 'schema')
    const where = await query<{ db: string; schema: string }>(
      appUrl('cli-a'),
      'SELECT current_database() AS db, current_schema() AS schema',
    )
    assert.deepEqual(where.rows[0], { db: INSTANCE.database, schema: 'app_cli_a' })

    // The pool's tables, as the auth service will make them: apps may read and reference users.
    await query(
      pool(),
      `CREATE SCHEMA auth;
       CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
       CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users);
       GRANT USAGE ON SCHEMA auth TO ${INSTANCE.group};
       GRANT SELECT, REFERENCES ON auth.users TO ${INSTANCE.group};`,
    )
  })

  it('puts unqualified tables in the app schema, which may point at auth.users', async () => {
    const url = appUrl('cli-a')
    await query(
      url,
      `CREATE TABLE notes (
         id serial PRIMARY KEY,
         user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
         body text NOT NULL)`,
    )
    const table = await query<{ schema: string }>(
      url,
      `SELECT schemaname AS schema FROM pg_tables WHERE tablename = 'notes'`,
    )
    assert.equal(table.rows[0].schema, 'app_cli_a')

    // The pool deletes a user; the app's rows go with them, though the pool has no rights on them.
    const user = await query<{ id: string }>(
      pool(),
      'INSERT INTO auth.users DEFAULT VALUES RETURNING id',
    )
    await query(url, `INSERT INTO notes (user_id, body) VALUES ('${user.rows[0].id}', 'hi')`)
    await query(pool(), `DELETE FROM auth.users WHERE id = '${user.rows[0].id}'`)
    assert.equal((await query(url, 'SELECT 1 FROM notes')).rowCount, 0)
  })

  it('keeps the app out of auth beyond users, other schemas and new schemas', async () => {
    const a = appUrl('cli-a')
    assert.equal(await failure(a, 'SELECT count(*) FROM auth.users'), undefined)
    assert.match((await failure(a, 'SELECT * FROM auth.sessions')) ?? '', /permission denied/)
    assert.match((await failure(a, 'DELETE FROM auth.users')) ?? '', /permission denied/)
    assert.match((await failure(a, 'CREATE TABLE auth.extra (id int)')) ?? '', /permission denied/)
    assert.match((await failure(a, 'CREATE SCHEMA drizzle')) ?? '', /permission denied/)
    assert.match((await failure(a, 'CREATE TABLE public.x (id int)')) ?? '', /permission denied/)
    assert.match(
      (await failure(appUrl('cli-b'), 'SELECT * FROM app_cli_a.notes')) ?? '',
      /permission denied for schema/,
    )
  })

  it('gives the app role no special attributes and the admin no inherited rights', async () => {
    const role = await query<{
      rolsuper: boolean
      rolcreatedb: boolean
      rolcreaterole: boolean
      rolconnlimit: number
    }>(
      adminUrl(),
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolconnlimit FROM pg_roles WHERE rolname = 'app_cli_a'`,
    )
    assert.deepEqual(role.rows[0], {
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolconnlimit: 20,
    })
    const membership = await query<{ inherits: boolean; sets: boolean }>(
      adminUrl(),
      `SELECT pg_has_role('${ADMIN}', 'app_cli_a', 'USAGE') AS inherits, pg_has_role('${ADMIN}', 'app_cli_a', 'SET') AS sets`,
    )
    assert.deepEqual(membership.rows[0], { inherits: false, sets: true })
    const timeout = await query<{ statement_timeout: string }>(
      appUrl('cli-a'),
      'SHOW statement_timeout',
    )
    assert.equal(timeout.rows[0].statement_timeout, '30s')
  })

  it("updates the app's password when it changes", async () => {
    await provision(adminUrl(), options('cli-b', 2))
    assert.match(
      (await failure(appUrl('cli-b', pw('cli-b', 1)), 'SELECT 1')) ?? '',
      /password authentication failed/,
    )
    assert.equal(await failure(appUrl('cli-b', pw('cli-b', 2)), 'SELECT 1'), undefined)
  })

  it('purges an app with its schema, and purging again does nothing', async () => {
    await purge(adminUrl(), 'cli-a', INSTANCE)
    await purge(adminUrl(), 'cli-a', INSTANCE)
    const left = await query(
      urlFor(ADMIN, ADMIN_PASSWORD, INSTANCE.database),
      `SELECT 1 FROM pg_namespace WHERE nspname = 'app_cli_a' UNION ALL SELECT 1 FROM pg_roles WHERE rolname = 'app_cli_a'`,
    )
    assert.equal(left.rowCount, 0)
    assert.equal(await appLayout(adminUrl(), 'cli-a', INSTANCE), 'none')
  })

  it('keeps an app that has its own database there, until it is purged', async () => {
    // An app made before ADR 0034: its own role and database, made by the admin.
    await query(adminUrl(), `CREATE ROLE app_cli_old LOGIN PASSWORD '${pw('cli-old')}'`)
    await query(adminUrl(), `GRANT app_cli_old TO ${ADMIN} WITH INHERIT FALSE, SET TRUE`)
    await query(adminUrl(), 'CREATE DATABASE app_cli_old OWNER app_cli_old')
    const own = urlFor('app_cli_old', pw('cli-old'), 'app_cli_old')
    await query(own, 'CREATE TABLE kept (id int)')

    assert.deepEqual(await provision(adminUrl(), options('cli-old')), { database: 'app_cli_old' })
    assert.equal(await appLayout(adminUrl(), 'cli-old', INSTANCE), 'database')
    assert.equal(await failure(own, 'SELECT * FROM kept'), undefined, 'search_path unchanged')
    const schema = await query(
      urlFor(ADMIN, ADMIN_PASSWORD, INSTANCE.database),
      `SELECT 1 FROM pg_namespace WHERE nspname = 'app_cli_old'`,
    )
    assert.equal(schema.rowCount, 0, 'no schema in the instance database')

    await purge(adminUrl(), 'cli-old', INSTANCE)
    const left = await query(
      adminUrl(),
      `SELECT 1 FROM pg_database WHERE datname = 'app_cli_old' UNION ALL SELECT 1 FROM pg_roles WHERE rolname = 'app_cli_old'`,
    )
    assert.equal(left.rowCount, 0)
  })

  it('refuses names that are not app names', () => {
    assert.equal(appRoleName('blog-api'), 'app_blog_api')
    for (const bad of [
      'Blog',
      'blog_api',
      '-blog',
      'a',
      `x${'y'.repeat(32)}`,
      'a"; drop role x; --',
    ])
      assert.throws(() => appRoleName(bad), /Not a valid app name/)
  })
})
