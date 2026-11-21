import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { buildApp } from '../src/app.ts'
import { Apps } from '../src/apps.ts'
import { buildFacts, caddyJson, Legal, type PlatformFacts, parseOwner } from '../src/legal.ts'
import type { Runner } from '../src/runner.ts'
import { Store } from '../src/store.ts'

const TOKEN = 'test-token-0123456789abcdef0123456789'
const auth = { authorization: `Bearer ${TOKEN}` }

const platform: PlatformFacts = {
  edge: 'direct',
  backupDays: 30,
  analytics: { mode: 'server', days: 395 },
  guestDays: 180,
  ipDays: 30,
}

const owner = {
  name: 'Ivo Example',
  address: 'Ulica 1\n10000 Zagreb\nCroatia',
  email: 'privacy@example.com',
  authority: { name: 'AZOP', url: 'https://azop.hr' },
  hosting: { name: 'Hetzner Online GmbH', country: 'de' },
}

describe('legal facts (ADR 0043)', () => {
  it('lists only what the instance does: hosting, accounts and sessions at the least', () => {
    const facts = buildFacts(null, platform)
    assert.equal(facts.controller, null)
    assert.deepEqual(
      facts.processing.map((p) => p.id),
      ['hosting', 'accounts', 'sessions'],
    )
    assert.deepEqual(facts.processing[1], { id: 'accounts', basis: 'contract', retentionDays: 180 })
    assert.equal(facts.processing[2]?.retentionDays, 30)
  })

  it('adds Cloudflare as the edge, the backup bucket and analytics when they are set up', () => {
    const facts = buildFacts(null, {
      ...platform,
      edge: 'cloudflare',
      backupEndpoint: 'https://acct.eu.r2.cloudflarestorage.com',
      analytics: { mode: 'opt-out', days: 395 },
    })
    const byId = Object.fromEntries(facts.processing.map((p) => [p.id, p]))
    assert.deepEqual(byId.edge?.transfer, { country: 'US', basis: 'dpf' })
    assert.equal(byId.edge?.processor?.name, 'Cloudflare, Inc.')
    assert.deepEqual(byId.backups?.processor, { name: 'Cloudflare, Inc.', country: 'EU' })
    assert.equal(byId.backups?.retentionDays, 30)
    assert.equal(byId.analytics?.basis, 'legitimate-interests')
    assert.equal(byId.analytics?.retentionDays, 395)
    const optIn = buildFacts(null, { ...platform, analytics: { mode: 'opt-in', days: 395 } })
    assert.equal(optIn.processing.find((p) => p.id === 'analytics')?.basis, 'consent')

    const other = buildFacts(null, { ...platform, backupEndpoint: 'https://s3.example.net' })
    const backups = other.processing.find((p) => p.id === 'backups')
    assert.deepEqual(backups?.processor, { name: 's3.example.net', country: null })
    assert.equal(backups?.transfer, undefined)
  })

  it("checks the owner's details and names what is missing", () => {
    const parsed = parseOwner(owner)
    assert.ok(typeof parsed !== 'string')
    assert.deepEqual(parsed.address, ['Ulica 1', '10000 Zagreb', 'Croatia'])
    assert.equal(parsed.hosting.country, 'DE')
    assert.match(String(parseOwner({ ...owner, name: ' ' })), /name/)
    assert.match(String(parseOwner({ ...owner, email: 'nope' })), /email/)
    assert.match(
      String(parseOwner({ ...owner, authority: { name: 'AZOP', url: 'javascript:x' } })),
      /web address/,
    )
    assert.match(
      String(parseOwner({ ...owner, hosting: { name: 'X', country: 'D' } })),
      /two letters/,
    )
  })

  it("escapes what a Caddyfile would read in strings, and keeps the JSON's meaning", () => {
    const value = { a: 'back`tick {client_ip} }', b: [{ c: 1 }] }
    const json = caddyJson(value)
    assert.doesNotMatch(json, /`/)
    assert.doesNotMatch(json, /\{client_ip\}/)
    assert.deepEqual(JSON.parse(json), value)
  })

  describe('the store', () => {
    let dir: string
    let now = new Date('2026-11-21T10:00:00Z')
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'spotcraft-legal-'))
    })
    afterEach(() => rm(dir, { recursive: true, force: true }))

    it('dates the facts when they change, and only then', async () => {
      const legal = new Legal(dir, platform, () => now)
      assert.equal((await legal.facts()).updated, '2026-11-21')
      now = new Date('2026-11-25T10:00:00Z')
      assert.equal((await legal.facts()).updated, '2026-11-21', 'nothing changed')

      const parsed = parseOwner(owner)
      assert.ok(typeof parsed !== 'string')
      assert.equal(await legal.setOwner(parsed), true)
      assert.equal((await legal.facts()).updated, '2026-11-25')
      assert.equal((await legal.facts()).controller?.name, 'Ivo Example')
      now = new Date('2026-11-26T10:00:00Z')
      assert.equal(await legal.setOwner(parsed), false, 'the same details again')
      assert.equal((await legal.facts()).updated, '2026-11-25')

      assert.ok(
        await readFile(join(dir, 'apps/.legal.json'), 'utf8'),
        'kept where the agent can write',
      )

      // The instance changed: backups were turned on.
      const later = new Legal(
        dir,
        { ...platform, backupEndpoint: 'https://s3.example.net' },
        () => now,
      )
      assert.equal((await later.facts()).updated, '2026-11-26')
    })
  })

  it("still answers the facts when their date can't be saved, as on a read-only disk", {
    skip: process.getuid?.() === 0 && 'root ignores file permissions',
  }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spotcraft-legal-ro-'))
    try {
      await mkdir(join(dir, 'apps'))
      await chmod(join(dir, 'apps'), 0o500)
      const legal = new Legal(dir, platform, () => new Date('2026-11-21T10:00:00Z'))
      const facts = await legal.facts()
      assert.equal(facts.updated, '2026-11-21')
      assert.deepEqual(
        facts.processing.map((p) => p.id),
        ['hosting', 'accounts', 'sessions'],
      )
      const parsed = parseOwner(owner)
      assert.ok(typeof parsed !== 'string')
      await assert.rejects(legal.setOwner(parsed), 'saving the owner still says it failed')
    } finally {
      await chmod(join(dir, 'apps'), 0o700)
      await rm(dir, { recursive: true, force: true })
    }
  })

  describe('the agent', () => {
    let dir: string
    let app: ReturnType<typeof buildApp>
    let apps: Apps
    const ups: string[] = []
    const run: Runner = async (_file, args) => {
      if (args.includes('up')) ups.push(args.join(' '))
      return { code: 0, stdout: '', stderr: '' }
    }

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'spotcraft-legal-agent-'))
      ups.length = 0
      apps = new Apps(new Store(dir), run, 'caddy', undefined, { edge: 'direct' })
      apps.legal = new Legal(dir, platform)
      app = buildApp({ token: TOKEN, apps })
    })
    afterEach(async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    })

    it("doesn't take the facts file for an app", async () => {
      await mkdir(join(dir, 'apps'), { recursive: true })
      await writeFile(join(dir, 'apps/.legal.json'), '{}')
      const list = await app.inject({ url: '/apps', headers: auth })
      assert.deepEqual(list.json().apps, [])
    })

    it('serves the facts on every site, gives them to apps, and deploys apps when they change', async () => {
      const put = await app.inject({
        method: 'PUT',
        url: '/apps/blog',
        headers: auth,
        payload: { image: 'vindotski/blog', tag: '1.0.0', domain: 'blog.example.com' },
      })
      assert.equal(put.statusCode, 200, put.body)
      const site = () => readFile(join(dir, 'sites/blog.caddy'), 'utf8')
      assert.match(await site(), /handle \/_spotcraft\/legal\.json \{/)
      assert.match(await site(), /"controller":null/)
      const compose = () => readFile(join(dir, 'apps/blog/compose.yaml'), 'utf8')
      assert.match(await compose(), /LEGAL_FACTS/)

      const bad = await app.inject({ method: 'PUT', url: '/legal', headers: auth, payload: {} })
      assert.equal(bad.statusCode, 400)

      const saved = await app.inject({
        method: 'PUT',
        url: '/legal',
        headers: auth,
        payload: owner,
      })
      assert.equal(saved.statusCode, 200, saved.body)
      assert.deepEqual(saved.json().redeploying, ['blog'])
      assert.equal(saved.json().facts.controller.name, 'Ivo Example')
      assert.match(await site(), /Ivo Example/, 'served at once')

      // The redeploy runs in the queue; the next queued call waits for it.
      await apps.list()
      await app.inject({ url: '/legal', headers: auth })
      for (let i = 0; i < 50 && !/Ivo Example/.test(await compose()); i++) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert.match(await compose(), /Ivo Example/)

      const again = await app.inject({
        method: 'PUT',
        url: '/legal',
        headers: auth,
        payload: owner,
      })
      assert.deepEqual(again.json().redeploying, [], 'nothing changed, nothing deployed')
      const read = await app.inject({ url: '/legal', headers: auth })
      assert.equal(read.json().owner.email, 'privacy@example.com')
    })
  })
})
