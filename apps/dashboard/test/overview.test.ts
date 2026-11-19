import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { byApp, sortApps, sumHosts, troubled } from '../src/lib/overview.ts'

const app = (
  name: string,
  state = 'running',
  health = 'healthy',
  hostnames = [`${name}.example.com`],
) => ({
  name,
  state,
  health,
  hostnames,
})

describe('home overview', () => {
  it('lists apps that need a look first, then by name', () => {
    const apps = [
      app('blog'),
      app('shop', 'exited'),
      app('api'),
      app('wiki', 'running', 'unhealthy'),
    ]
    assert.deepEqual(
      sortApps(apps).map((a) => a.name),
      ['shop', 'wiki', 'api', 'blog'],
    )
    assert.deepEqual(troubled(apps), ['shop', 'wiki'])
  })
  it('does not count a starting app as trouble', () => {
    assert.deepEqual(troubled([app('blog', 'running', 'starting')]), [])
  })
  it('maps Compose projects to app names and drops the rest', () => {
    const series = { 'spotcraft-app-blog': 1, 'spotcraft-apps': 2 }
    assert.deepEqual(byApp([app('blog'), app('shop')], series), { blog: 1 })
  })
  it('sums requests over every host of an app', () => {
    const apps = [app('blog', 'running', 'healthy', ['blog.example.com', 'blog.dev']), app('shop')]
    const byHost = { 'blog.example.com': 10, 'blog.dev': 5, 'other.dev': 99 }
    assert.deepEqual(sumHosts(apps, byHost), { blog: 15 })
  })
})

describe('app tiles', async () => {
  const { hue, iconType } = await import('../src/lib/icon.ts')
  it('gives a name the same hue every time', () => {
    assert.equal(hue('blog'), hue('blog'))
    assert.ok(hue('blog') >= 0 && hue('blog') < 360)
  })
  it('serves raster icons only, never SVG or HTML', () => {
    assert.equal(iconType('image/png'), 'image/png')
    assert.equal(iconType('image/x-icon; charset=binary'), 'image/x-icon')
    assert.equal(iconType('image/svg+xml'), null)
    assert.equal(iconType('text/html'), null)
    assert.equal(iconType(null), null)
  })
})

describe('row figures', () => {
  it('reads memory limits as the agent takes them', async () => {
    const { memoryLimit } = await import('../src/lib/overview.ts')
    assert.equal(memoryLimit('512m'), 512 * 1024 ** 2)
    assert.equal(memoryLimit('1g'), 1024 ** 3)
    assert.equal(memoryLimit('lots'), null)
  })
  it('makes one bar per hour, oldest first, with gaps where nothing was probed', async () => {
    const { hourlyBars } = await import('../src/lib/overview.ts')
    const now = 100 * 3600 + 1200
    const bars = hourlyBars(
      [
        [99 * 3600, 1],
        [100 * 3600, 0.5],
      ],
      now,
      3,
    )
    assert.deepEqual(bars, [
      { at: 98 * 3600, ratio: null },
      { at: 99 * 3600, ratio: 1 },
      { at: 100 * 3600, ratio: 0.5 },
    ])
  })
})

describe('icon download', () => {
  it('reads a body up to the limit, and refuses a longer one without keeping it', async () => {
    const { readLimited } = await import('../src/lib/icon.ts')
    const small = await readLimited(new Response(new Uint8Array(10)), 16)
    assert.equal(small?.byteLength, 10)
    // No Content-Length: the stream itself is cut off past the limit.
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(8))
      },
    })
    assert.equal(await readLimited(new Response(stream), 16), null)
    const declared = new Response('x', { headers: { 'content-length': '999999' } })
    assert.equal(await readLimited(declared, 16), null)
  })
})
