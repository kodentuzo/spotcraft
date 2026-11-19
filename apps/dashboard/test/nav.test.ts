import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { currentApp, isCurrent, switchHref, titleFor } from '../src/lib/nav.ts'

const q = (s = '') => new URLSearchParams(s)

describe('sidebar and header bar', () => {
  it('marks Apps current on every app page', () => {
    assert.ok(isCurrent('/', '/apps/blog'))
    assert.ok(isCurrent('/logs', '/logs'))
    assert.ok(!isCurrent('/users', '/usage'))
  })
  it('titles each page', () => {
    assert.equal(titleFor('/'), 'Apps')
    assert.equal(titleFor('/apps/blog'), 'Overview')
    assert.equal(titleFor('/apps/new'), 'New app')
    assert.equal(titleFor('/backups'), 'Backups')
    assert.equal(titleFor('/apps/blog', q('tab=usage')), 'Usage')
  })
  it('knows which app a page is about, and keeps the view when switching', () => {
    assert.equal(currentApp('/apps/blog', q()), 'blog')
    assert.equal(currentApp('/apps/new', q()), undefined)
    assert.equal(currentApp('/logs', q('app=shop')), 'shop')
    assert.equal(switchHref('/logs', q('app=blog'), 'shop'), '/logs?app=shop')
    assert.equal(switchHref('/apps/blog', q('tab=usage'), 'shop'), '/apps/shop?tab=usage')
    assert.equal(switchHref('/users', q(), 'shop'), '/apps/shop')
  })
})
