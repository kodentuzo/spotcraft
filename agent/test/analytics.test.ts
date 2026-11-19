import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Umami } from '../src/analytics.ts'

const PASSWORD = 'a-password-of-the-agents-own-0123456789'

/** A fake Umami API: an admin account, websites, and the calls it was sent. */
function fakeUmami(initialPassword = 'umami') {
  let password = initialPassword
  const tokens = new Set<string>()
  const websites = new Map<string, { name: string; domain: string }>()
  const calls: string[] = []
  let n = 0
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url.pathname}`)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (url.pathname === '/api/auth/login') {
      if (body.username !== 'admin' || body.password !== password) return json(401, {})
      const token = `t${++n}`
      tokens.add(token)
      return json(200, { token })
    }
    const token = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '')
    if (!token || !tokens.has(token)) return json(401, {})
    if (url.pathname === '/api/me/password' && method === 'POST') {
      if (body.currentPassword !== password) return json(400, {})
      password = body.newPassword
      return json(200, {})
    }
    if (url.pathname === '/api/websites' && method === 'POST') {
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
      websites.set(id, body)
      return json(200, { id })
    }
    const numbers = /^\/api\/websites\/[^/]+\/(stats|metrics|pageviews)$/.exec(url.pathname)?.[1]
    if (numbers === 'pageviews') {
      return json(200, {
        pageviews: [
          { x: '2026-11-18 00:00:00', y: 4 },
          { x: '2026-11-19 00:00:00', y: 6 },
        ],
        sessions: [{ x: '2026-11-19 00:00:00', y: 2 }],
      })
    }
    if (numbers === 'stats') return json(200, { pageviews: 12, visitors: 5, visits: 7 })
    if (numbers === 'metrics') {
      const type = url.searchParams.get('type')
      // An older Umami refuses a type it doesn't know.
      if (type === 'event') return json(400, { error: 'Invalid type' })
      return json(
        200,
        type === 'country'
          ? [
              { x: 'HR', y: 4 },
              { x: null, y: 1 },
            ]
          : [{ x: 'x', y: 2 }],
      )
    }
    const id = /^\/api\/websites\/(.+)$/.exec(url.pathname)?.[1]
    // Like Umami: an admin gets 200 and `null` for a website that doesn't exist.
    if (id && method === 'GET') {
      return json(200, websites.has(id) ? { id, ...websites.get(id) } : null)
    }
    if (id && method === 'DELETE') return websites.delete(id) ? json(200, {}) : json(404, {})
    return json(404, {})
  }
  return { fetch, websites, calls, password: () => password, expire: () => tokens.clear() }
}

describe("the agent's Umami client", () => {
  it("replaces Umami's default password the first time, and uses its own afterwards", async () => {
    const umami = fakeUmami()
    const id = await new Umami('http://umami:3000', PASSWORD, umami).ensureWebsite(
      'blog',
      'blog.app',
    )
    assert.equal(umami.password(), PASSWORD)
    assert.deepEqual(umami.websites.get(id), { name: 'blog', domain: 'blog.app' })
    umami.calls.length = 0
    await new Umami('http://umami:3000', PASSWORD, umami).ensureWebsite('shop', 'shop.app')
    assert.deepEqual(umami.calls, ['POST /api/auth/login', 'POST /api/websites'])
  })

  it('keeps a website Umami still has, and makes a new one for one it lost', async () => {
    const umami = fakeUmami(PASSWORD)
    const client = new Umami('http://umami:3000', PASSWORD, umami)
    const id = await client.ensureWebsite('blog', 'blog.app')
    assert.equal(await client.ensureWebsite('blog', 'blog.app', id), id)
    umami.websites.clear()
    const again = await client.ensureWebsite('blog', 'blog.app', id)
    assert.notEqual(again, id)
    assert.ok(umami.websites.has(again))
  })

  it('signs in again when its token expires, and deletes a website once', async () => {
    const umami = fakeUmami(PASSWORD)
    const client = new Umami('http://umami:3000', PASSWORD, umami)
    const id = await client.ensureWebsite('blog', 'blog.app')
    umami.expire()
    await client.deleteWebsite(id)
    assert.equal(umami.websites.size, 0)
    await client.deleteWebsite(id)
  })

  it('says clearly when its password is refused, or Umami does not answer', async () => {
    const refused = new Umami('http://umami:3000', PASSWORD, fakeUmami('someone-elses-password'))
    await assert.rejects(refused.ensureWebsite('blog', 'blog.app'), /refused the agent's password/)
    const away = new Umami('http://umami:3000', PASSWORD, {
      fetch: async () => {
        throw new TypeError('fetch failed')
      },
    })
    await assert.rejects(away.ensureWebsite('blog', 'blog.app'), /Umami did not answer/)
  })

  it('reads every breakdown, and leaves one Umami refuses empty', async () => {
    const umami = fakeUmami(PASSWORD)
    const client = new Umami('http://umami:3000', PASSWORD, umami)
    const summary = await client.summary('site', 7)
    assert.equal(summary.visitors, 5)
    assert.deepEqual(summary.countries, [
      { name: 'HR', count: 4 },
      { name: '(unknown)', count: 1 },
    ])
    assert.deepEqual(summary.referrers, [{ name: 'x', count: 2 }])
    assert.deepEqual(summary.events, [])
    assert.deepEqual(summary.perDay, [
      { day: '2026-11-18', views: 4, visitors: 0 },
      { day: '2026-11-19', views: 6, visitors: 2 },
    ])
  })

  it('asks only for the totals when brief', async () => {
    const umami = fakeUmami(PASSWORD)
    const summary = await new Umami('http://umami:3000', PASSWORD, umami).summary('site', 7, true)
    assert.equal(summary.visitors, 5)
    assert.deepEqual(summary.countries, [])
    assert.deepEqual(summary.perDay, [])
    assert.deepEqual(
      umami.calls.filter((call) => call.includes('/websites/site/')),
      ['GET /api/websites/site/stats'],
    )
  })
})
