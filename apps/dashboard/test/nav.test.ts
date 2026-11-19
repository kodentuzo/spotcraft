import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hrefFor, scopeOf, switchHref, tabHref, titleFor } from '../src/lib/nav.ts'

describe('sidebar and switcher', () => {
  it('puts each section at the page first, then the app', () => {
    assert.equal(hrefFor('usage'), '/usage')
    assert.equal(hrefFor('usage', 'blog'), '/usage/blog')
    assert.equal(hrefFor('overview'), '/')
    assert.equal(hrefFor('overview', 'blog'), '/apps/blog')
  })
  it('reads the section and app from a path', () => {
    assert.deepEqual(scopeOf('/'), { section: 'overview' })
    assert.deepEqual(scopeOf('/apps/blog'), { section: 'overview', app: 'blog' })
    assert.deepEqual(scopeOf('/apps/blog/edit'), { section: 'overview', app: 'blog', page: 'edit' })
    assert.deepEqual(scopeOf('/apps/new'), { section: 'overview', page: 'new' })
    assert.deepEqual(scopeOf('/logs/shop'), { section: 'logs', app: 'shop' })
    assert.deepEqual(scopeOf('/settings'), { section: 'settings' })
    assert.deepEqual(scopeOf('/login'), {})
  })
  it('keeps the section when switching apps, and drops the app for all apps', () => {
    assert.equal(switchHref('/usage', 'blog'), '/usage/blog')
    assert.equal(switchHref('/settings/blog'), '/settings')
    assert.equal(switchHref('/apps/blog/edit', 'shop'), '/apps/shop')
    assert.equal(switchHref('/', 'shop'), '/apps/shop')
  })
  it('titles pages by section', () => {
    assert.equal(titleFor('/'), 'Apps')
    assert.equal(titleFor('/apps/blog'), 'Overview')
    assert.equal(titleFor('/backups/blog'), 'Backups')
    assert.equal(titleFor('/apps/new'), 'New app')
  })
  it('sends old app tab links to their section', () => {
    assert.equal(tabHref('blog', 'usage'), '/usage/blog')
    assert.equal(tabHref('blog', 'settings'), '/settings/blog')
    assert.equal(tabHref('blog', null), undefined)
  })
})
