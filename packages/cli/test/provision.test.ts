// Runs against a real Postgres. KIT_TEST_POSTGRES_URL is a superuser URL for a throwaway
// server (CI starts one); without it these tests are skipped locally and fail in CI.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import pg from 'pg'
import { appDatabaseName, provision, purge } from '../src/provision.ts'

const SUPERUSER_URL = process.env.KIT_TEST_POSTGRES_URL
if (!SUPERUSER_URL && process.env.CI) throw new Error('KIT_TEST_POSTGRES_URL is not set')

const ADMIN = 'cli_test_admin'
const ADMIN_PASSWORD = 'admin-password-0123456789'
const APPS = ['cli-a', 'cli-b']
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
const appUrl = (name: string, password = pw(name), database = appDatabaseName(name)) =>
  urlFor(appDatabaseName(name), password, database)

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
  before(async () => {
    const su = SUPERUSER_URL as string
    for (const name of APPS)
      await query(su, `DROP DATABASE IF EXISTS ${appDatabaseName(name)} WITH (FORCE)`)
    for (const name of APPS) await query(su, `DROP ROLE IF EXISTS ${appDatabaseName(name)}`)
    await query(su, `DROP ROLE IF EXISTS ${ADMIN}`)
    // Like the server's spotcraft_agent, but without its createrole_self_grant setting:
    // provision must not depend on it.
    await query(su, `CREATE ROLE ${ADMIN} LOGIN CREATEDB CREATEROLE PASSWORD '${ADMIN_PASSWORD}'`)
  })

  after(async () => {
    if (!SUPERUSER_URL) return
    for (const name of APPS) await purge(adminUrl(), name)
    await query(SUPERUSER_URL, `DROP ROLE IF EXISTS ${ADMIN}`)
  })

  it('provisions an empty database, and running it again changes nothing', async () => {
    for (const name of APPS) await provision(adminUrl(), { name, password: pw(name) })
    await provision(adminUrl(), { name: 'cli-a', password: pw('cli-a') })
    const schemas = await query<{ name: string }>(
      appUrl('cli-a'),
      `SELECT nspname AS name FROM pg_namespace
       WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' ORDER BY 1`,
    )
    assert.deepEqual(
      schemas.rows.map((row) => row.name),
      ['public'],
    )
  })

  it('lets the app own its database and create its tables', async () => {
    const url = appUrl('cli-a')
    await query(url, 'CREATE TABLE public.notes (id serial PRIMARY KEY, body text)')
    await query(url, 'CREATE SCHEMA game')
    const owner = await query<{ owner: string }>(
      url,
      `SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = current_database()`,
    )
    assert.equal(owner.rows[0].owner, 'app_cli_a')
  })

  it('lets an app into its own database only', async () => {
    assert.match(
      (await failure(appUrl('cli-a', pw('cli-a'), 'app_cli_b'), 'SELECT 1')) ?? '',
      /permission denied for database/,
    )
    assert.match(
      (await failure(appUrl('cli-b', pw('cli-b'), 'app_cli_a'), 'SELECT 1')) ?? '',
      /permission denied for database/,
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
    await provision(adminUrl(), { name: 'cli-b', password: pw('cli-b', 2) })
    assert.match(
      (await failure(appUrl('cli-b', pw('cli-b', 1)), 'SELECT 1')) ?? '',
      /password authentication failed/,
    )
    assert.equal(await failure(appUrl('cli-b', pw('cli-b', 2)), 'SELECT 1'), undefined)
  })

  it('purges an app, and purging again does nothing', async () => {
    await purge(adminUrl(), 'cli-b')
    await purge(adminUrl(), 'cli-b')
    const left = await query(
      adminUrl(),
      `SELECT 1 FROM pg_database WHERE datname = 'app_cli_b' UNION ALL SELECT 1 FROM pg_roles WHERE rolname = 'app_cli_b'`,
    )
    assert.equal(left.rowCount, 0)
  })

  it('refuses names that are not app names', () => {
    assert.equal(appDatabaseName('blog-api'), 'app_blog_api')
    for (const bad of [
      'Blog',
      'blog_api',
      '-blog',
      'a',
      `x${'y'.repeat(32)}`,
      'a"; drop role x; --',
    ])
      assert.throws(() => appDatabaseName(bad), /Not a valid app name/)
  })
})
