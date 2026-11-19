// The pool against a real Postgres, through its HTTP server, with Host headers as Caddy sends
// them. KIT_TEST_POSTGRES_URL is a superuser URL for a throwaway server (CI starts one);
// without it these tests are skipped locally and fail in CI.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import pg from 'pg'
import { deleteIdleGuests } from '../src/cleanup.ts'
import type { Config } from '../src/config.ts'
import { formerSecrets } from '../src/former.ts'
import { loadMigrations, migrate } from '../src/migrate.ts'
import { createPool } from '../src/pool.ts'
import { accounts, jwks, sessions, users, verifications } from '../src/schema.ts'
import { createAuthServer } from '../src/server.ts'

const SUPERUSER_URL = process.env.KIT_TEST_POSTGRES_URL
if (!SUPERUSER_URL && process.env.CI) throw new Error('KIT_TEST_POSTGRES_URL is not set')

// Its own instance database and roles, so other packages' tests on the same server can't clash.
const DATABASE = 'auth_test_apps'
const POOL_ROLE = 'auth_test_pool'
const GROUP = 'auth_test_app'
const APP = 'app_auth_test'
const ADMIN = 'auth_test_agent'
const PASSWORD = 'auth-test-password-0123456789'

function urlFor(user: string, password: string, database = DATABASE) {
  const url = new URL(SUPERUSER_URL as string)
  url.username = user
  url.password = password
  url.pathname = `/${database}`
  return url.toString()
}

async function query<T extends pg.QueryResultRow>(
  url: string,
  sql: string,
  params: unknown[] = [],
) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await client.query<T>(sql, params)
  } finally {
    await client.end()
  }
}

interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

describe('the user pool', { skip: !SUPERUSER_URL && 'KIT_TEST_POSTGRES_URL is not set' }, () => {
  const su = () => SUPERUSER_URL as string
  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    logLevel: 'error',
    databaseUrl: '',
    secret: 'auth-test-secret-0123456789-0123456789',
    issuer: 'https://auth.example.test/main',
    protocol: 'https',
    trustedOrigins: ['https://expo.example.test'],
    localOrigins: false,
    appGroup: GROUP,
    adminRole: ADMIN,
    guestDays: 180,
  }
  let db: pg.Pool
  let port: number
  let close: () => Promise<void>

  /** A request to the pool as Caddy sends it: the site's Host, the client's address. */
  function send(
    method: string,
    path: string,
    {
      host,
      ip = '203.0.113.1',
      headers = {},
      body,
    }: {
      host: string
      ip?: string
      headers?: Record<string, string>
      body?: unknown
    },
  ): Promise<Reply> {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          method,
          path,
          headers: {
            host,
            'x-spotcraft-client-ip': ip,
            ...(payload ? { 'content-type': 'application/json' } : {}),
            ...headers,
          },
        },
        (res) => {
          let text = ''
          res.on('data', (chunk) => {
            text += chunk
          })
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
          )
        },
      )
      req.on('error', reject)
      req.end(payload)
    })
  }

  const signIn = (host: string, ip?: string, origin = `https://${host}`) =>
    send('POST', '/_spotcraft/auth/sign-in/anonymous', { host, ip, headers: { origin }, body: {} })

  async function cleanUp() {
    await query(su(), `DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`, [])
    for (const role of [APP, POOL_ROLE, GROUP, ADMIN]) {
      await query(su(), `DROP OWNED BY ${role} CASCADE`).catch(() => {})
      await query(su(), `DROP ROLE IF EXISTS ${role}`)
    }
  }

  before(async () => {
    const postgres = urlFor('postgres', new URL(su()).password)
    await cleanUp()
    // As the deploy script sets it up: the instance database, the app group, the pool's role
    // owning `auth`, and one app in its own schema.
    await query(su(), `CREATE DATABASE ${DATABASE}`)
    await query(su(), `CREATE ROLE ${GROUP} NOLOGIN`)
    await query(su(), `CREATE ROLE ${ADMIN} LOGIN PASSWORD '${PASSWORD}'`)
    await query(su(), `GRANT CONNECT ON DATABASE ${DATABASE} TO ${ADMIN}`)
    await query(su(), `CREATE ROLE ${POOL_ROLE} LOGIN PASSWORD '${PASSWORD}'`)
    await query(su(), `CREATE ROLE ${APP} LOGIN PASSWORD '${PASSWORD}' IN ROLE ${GROUP}`)
    await query(su(), `ALTER ROLE ${APP} SET search_path = ${APP}`)
    await query(postgres, `CREATE SCHEMA auth AUTHORIZATION ${POOL_ROLE}`)
    await query(postgres, `CREATE SCHEMA ${APP} AUTHORIZATION ${APP}`)

    config.databaseUrl = urlFor(POOL_ROLE, PASSWORD)
    db = new pg.Pool({ connectionString: config.databaseUrl })
    const client = await db.connect()
    try {
      const migrations = loadMigrations()
      assert.deepEqual(await migrate(client, GROUP, ADMIN), { from: 0, to: migrations.length })
      assert.deepEqual(await migrate(client, GROUP, 'no_such_role'), {
        from: migrations.length,
        to: migrations.length,
      })
    } finally {
      client.release()
    }
    const server = createAuthServer(
      createPool(config, db),
      config,
      async () => true,
      formerSecrets(db, 0),
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
    close = () => new Promise((resolve) => server.close(() => resolve()))
  })

  after(async () => {
    if (!SUPERUSER_URL) return
    await close?.()
    await db?.end()
    await cleanUp()
  })

  it('defines the same tables in Drizzle as in the SQL migrations', async () => {
    const columns = await query<{
      table_name: string
      column_name: string
      data_type: string
      is_nullable: string
    }>(
      urlFor(POOL_ROLE, PASSWORD),
      `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'auth' AND table_name NOT IN ('migrations', 'former_secrets')
       ORDER BY table_name, column_name`,
    )
    const fromDrizzle = [users, sessions, accounts, verifications, jwks]
      .flatMap((table: PgTable) => {
        const config = getTableConfig(table)
        return config.columns.map((c) => ({
          table_name: config.name,
          column_name: c.name,
          data_type: c.getSQLType(),
          is_nullable: c.notNull ? 'NO' : 'YES',
        }))
      })
      .sort((a, b) =>
        `${a.table_name}.${a.column_name}`.localeCompare(`${b.table_name}.${b.column_name}`),
      )
    assert.deepEqual(columns.rows, fromDrizzle)
  })

  it('answers health', async () => {
    const res = await send('GET', '/health', { host: 'pool' })
    assert.equal(res.status, 200)
  })

  it("makes a guest on any app's domain, with a cookie for that domain only", async () => {
    for (const host of ['lifts.example.test', 'bars.example.test']) {
      const res = await signIn(host)
      assert.equal(res.status, 200, res.body)
      const cookie = String(res.headers['set-cookie'])
      assert.match(cookie, /__Secure-better-auth\.session_token=/)
      assert.doesNotMatch(cookie, /Domain=/i, 'host-only, first-party')
      assert.match(cookie, /HttpOnly/)
      assert.ok(res.headers['set-auth-token'], 'a bearer token too')
      const { user } = JSON.parse(res.body)
      assert.equal(user.isAnonymous, true)
      assert.match(user.id, /^[0-9a-f-]{36}$/)
    }
  })

  it("refuses another site's request that carries a session, unless it is trusted", async () => {
    const guest = await signIn('lifts.example.test', '203.0.113.2')
    const cookie = String(guest.headers['set-cookie']).split(';')[0]
    const forged = await send('POST', '/_spotcraft/auth/sign-out', {
      host: 'lifts.example.test',
      headers: { origin: 'https://evil.example.test', cookie },
      body: {},
    })
    assert.equal(forged.status, 403, forged.body)
    const own = await send('POST', '/_spotcraft/auth/sign-out', {
      host: 'lifts.example.test',
      headers: { origin: 'https://lifts.example.test', cookie },
      body: {},
    })
    assert.equal(own.status, 200, own.body)

    const preflight = await send('OPTIONS', '/_spotcraft/auth/sign-in/anonymous', {
      host: 'auth.example.test',
      headers: { origin: 'https://expo.example.test', 'access-control-request-method': 'POST' },
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers['access-control-allow-origin'], 'https://expo.example.test')
    assert.match(String(preflight.headers['access-control-expose-headers']), /set-auth-token/)

    const trusted = await signIn('auth.example.test', '203.0.113.3', 'https://expo.example.test')
    assert.equal(trusted.status, 200, trusted.body)
    assert.equal(trusted.headers['access-control-allow-origin'], 'https://expo.example.test')
  })

  it("trusts an app's dev server on this machine only in a local stack", async () => {
    const local = { ...config, protocol: 'http' as const, localOrigins: true }
    const server = createAuthServer(createPool(local, db), local, async () => true)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const localPort = (server.address() as AddressInfo).port
    try {
      const at = (path: string, origin: string, cookie?: string) =>
        new Promise<Reply>((resolve, reject) => {
          const req = request(
            {
              host: '127.0.0.1',
              port: localPort,
              method: 'POST',
              path,
              headers: {
                host: `localhost:${localPort}`,
                origin,
                'content-type': 'application/json',
                ...(cookie ? { cookie } : {}),
              },
            },
            (res) => {
              let text = ''
              res.on('data', (chunk) => {
                text += chunk
              })
              res.on('end', () =>
                resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
              )
            },
          )
          req.on('error', reject)
          req.end('{}')
        })
      const guest = await at('/_spotcraft/auth/sign-in/anonymous', 'http://localhost:3000')
      assert.equal(guest.status, 200, guest.body)
      assert.equal(guest.headers['access-control-allow-origin'], 'http://localhost:3000')
      const cookie = String(guest.headers['set-cookie']).split(';')[0]
      assert.match(cookie, /^better-auth\.session_token=/, 'no __Secure- prefix over http')
      const forged = await at('/_spotcraft/auth/sign-out', 'https://evil.example.test', cookie)
      assert.equal(forged.status, 403)
      const own = await at('/_spotcraft/auth/sign-out', 'http://127.0.0.1:5173', cookie)
      assert.equal(own.status, 200, own.body)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('gives a JWT that verifies against the JWKS, for cookies and bearer tokens', async () => {
    const res = await signIn('lifts.example.test', '203.0.113.4')
    const { user } = JSON.parse(res.body)
    const token = String(res.headers['set-auth-token'])
    const cookie = String(res.headers['set-cookie']).split(';')[0]

    const variants: Record<string, string>[] = [{ cookie }, { authorization: `Bearer ${token}` }]
    for (const headers of variants) {
      const issued = await send('GET', '/_spotcraft/auth/token', {
        host: 'lifts.example.test',
        headers,
      })
      assert.equal(issued.status, 200, issued.body)
      const keys = createRemoteJWKSet(new URL(`http://127.0.0.1:${port}/_spotcraft/auth/jwks`))
      const { payload, protectedHeader } = await jwtVerify(JSON.parse(issued.body).token, keys, {
        issuer: config.issuer,
      })
      assert.equal(protectedHeader.alg, 'EdDSA')
      assert.equal(payload.sub, user.id)
      assert.equal(payload.is_anonymous, true)
      assert.equal(payload.email, undefined, 'only the claims in the contract')
      assert.ok(Number(payload.exp) - Number(payload.iat) <= 15 * 60)
    }
  })

  it('notes on each session the host and client it was made or last renewed with', async () => {
    const superuser = urlFor('postgres', new URL(su()).password)
    const session = async (userId: string) =>
      (
        await query(superuser, 'SELECT host, client FROM auth.sessions WHERE user_id = $1', [
          userId,
        ])
      ).rows[0]
    const made = await send('POST', '/_spotcraft/auth/sign-in/anonymous', {
      host: 'lifts-api.example.test',
      ip: '203.0.113.21',
      headers: { 'spotcraft-client': 'ios/1.4.0' },
      body: {},
    })
    const { user } = JSON.parse(made.body)
    assert.deepEqual(await session(user.id), {
      host: 'lifts-api.example.test',
      client: 'ios/1.4.0',
    })

    // A day later, the session is renewed through another host, by another build of the app.
    await query(
      superuser,
      `UPDATE auth.sessions SET updated_at = now() - interval '2 days',
         expires_at = now() + interval '363 days' WHERE user_id = $1`,
      [user.id],
    )
    const token = String(made.headers['set-auth-token'])
    const renewed = await send('GET', '/_spotcraft/auth/get-session', {
      host: 'auth.example.test',
      headers: { authorization: `Bearer ${token}`, 'spotcraft-client': 'android/2.0.0' },
    })
    assert.equal(renewed.status, 200, renewed.body)
    assert.deepEqual(await session(user.id), { host: 'auth.example.test', client: 'android/2.0.0' })

    // Anything but `<platform>/<version>` isn't kept.
    const odd = await send('POST', '/_spotcraft/auth/sign-in/anonymous', {
      host: 'lifts-api.example.test',
      ip: '203.0.113.22',
      headers: { 'spotcraft-client': 'iOS 18; iPhone15,2; id=abc' },
      body: {},
    })
    assert.equal((await session(JSON.parse(odd.body).user.id)).client, null)
  })

  it("keeps the sessions of an app's guests moved in from the kit, signed with its old secret", async () => {
    const agent = urlFor(ADMIN, PASSWORD)
    const kitSecret = 'kit-app-secret-0123456789-0123456789'
    const { rows } = await query<{ id: string }>(
      agent,
      `INSERT INTO auth.users (email, is_anonymous) VALUES ('temp@moved.example.test', true)
       RETURNING id`,
    )
    const token = 'moved-session-token-0123456789ab'
    await query(
      agent,
      `INSERT INTO auth.sessions (user_id, token, expires_at)
       VALUES ($1, $2, now() + interval '30 days')`,
      [rows[0].id, token],
    )
    const sign = (secret: string) => createHmac('sha256', secret).update(token).digest('base64')
    const name = '__Secure-better-auth.session_token'
    const cookie = `${name}=${encodeURIComponent(`${token}.${sign(kitSecret)}`)}`
    const asApp = () =>
      send('GET', '/_spotcraft/auth/token', { host: 'game.example.test', headers: { cookie } })

    assert.equal((await asApp()).status, 401, 'an unknown signature is no session')
    await query(agent, "INSERT INTO auth.former_secrets (secret, app) VALUES ($1, 'game')", [
      kitSecret,
    ])
    const moved = await asApp()
    assert.equal(moved.status, 200, moved.body)
    const keys = createRemoteJWKSet(new URL(`http://127.0.0.1:${port}/_spotcraft/auth/jwks`))
    const { payload } = await jwtVerify(JSON.parse(moved.body).token, keys)
    assert.equal(payload.sub, rows[0].id)
    const resigned = String(moved.headers['set-cookie'])
    assert.ok(
      resigned.startsWith(`${name}=${encodeURIComponent(`${token}.${sign(config.secret)}`)};`),
      "the browser gets the cookie signed with the pool's secret",
    )
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
      assert.ok(resigned.includes(`; ${attribute}`), attribute)
    }
    const again = await send('GET', '/_spotcraft/auth/token', {
      host: 'game.example.test',
      headers: { cookie: resigned.split(';')[0] },
    })
    assert.equal(again.status, 200, 'the re-signed cookie works on its own')
    assert.equal(again.headers['set-cookie'], undefined, 'and needs no re-signing')
  })

  it('limits new guests per client address', async () => {
    for (let i = 0; i < 30; i++) {
      assert.equal((await signIn('lifts.example.test', '198.51.100.7')).status, 200)
    }
    assert.equal((await signIn('lifts.example.test', '198.51.100.7')).status, 429)
    assert.equal((await signIn('lifts.example.test', '198.51.100.8')).status, 200)
  })

  it('lets apps read and reference users, but not their private columns', async () => {
    const app = urlFor(APP, PASSWORD)
    await query(
      app,
      `CREATE TABLE notes (
         id serial PRIMARY KEY,
         user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE)`,
    )
    const users = await query(app, 'SELECT id, is_anonymous, created_at FROM auth.users LIMIT 1')
    assert.equal(users.rowCount, 1)
    await assert.rejects(query(app, 'SELECT email FROM auth.users'), /permission denied/)
    await assert.rejects(query(app, 'SELECT * FROM auth.sessions'), /permission denied/)
    await assert.rejects(query(app, 'DELETE FROM auth.users'), /permission denied/)
  })

  it('lets the agent list and delete users, and nothing more', async () => {
    const agent = urlFor(ADMIN, PASSWORD)
    await query(agent, 'SELECT id, is_anonymous, created_at FROM auth.users')
    await query(agent, 'SELECT user_id, updated_at FROM auth.sessions')
    await assert.rejects(query(agent, 'SELECT * FROM auth.jwks'), /permission denied/)
    await assert.rejects(query(agent, "UPDATE auth.users SET name = 'x'"), /permission denied/)
  })

  it("deletes idle guests, and their rows in the apps' tables with them", async () => {
    const app = urlFor(APP, PASSWORD)
    const pool = urlFor(POOL_ROLE, PASSWORD)
    const old = await query<{ id: string }>(
      pool,
      `INSERT INTO auth.users (email, is_anonymous, created_at)
       VALUES ('old@guest.test', true, now() - interval '200 days') RETURNING id`,
    )
    const recent = await query<{ id: string }>(
      pool,
      `INSERT INTO auth.users (email, is_anonymous, created_at)
       VALUES ('recent@guest.test', true, now() - interval '200 days') RETURNING id`,
    )
    await query(
      pool,
      `INSERT INTO auth.sessions (user_id, token, expires_at, updated_at)
       VALUES ($1, 'recent-token', now() + interval '1 day', now() - interval '1 day')`,
      [recent.rows[0].id],
    )
    await query(app, 'INSERT INTO notes (user_id) VALUES ($1), ($2)', [
      old.rows[0].id,
      recent.rows[0].id,
    ])

    const { deleted, blocked } = await deleteIdleGuests(db, 180)
    assert.deepEqual({ deleted, blocked }, { deleted: 1, blocked: [] })
    const left = await query<{ user_id: string }>(app, 'SELECT user_id FROM notes')
    assert.deepEqual(
      left.rows.map((row) => row.user_id),
      [recent.rows[0].id],
    )
  })
})
