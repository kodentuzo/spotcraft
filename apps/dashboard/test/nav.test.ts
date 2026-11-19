import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hrefFor, movedHref, scopeOf, switchHref, titleFor } from '../src/lib/nav.ts'

describe('sidebar and switcher', () => {
  it('puts the app first, then the page', () => {
    assert.equal(hrefFor('usage'), '/usage')
    assert.equal(hrefFor('usage', 'blog'), '/blog/usage')
    assert.equal(hrefFor('overview'), '/')
    assert.equal(hrefFor('overview', 'blog'), '/blog')
  })
  it('reads the section and app from a path', () => {
    assert.deepEqual(scopeOf('/'), { section: 'overview' })
    assert.deepEqual(scopeOf('/blog'), { section: 'overview', app: 'blog' })
    assert.deepEqual(scopeOf('/blog/edit'), { section: 'overview', app: 'blog', page: 'edit' })
    assert.deepEqual(scopeOf('/new'), { section: 'overview', page: 'new' })
    assert.deepEqual(scopeOf('/shop/logs'), { section: 'logs', app: 'shop' })
    assert.deepEqual(scopeOf('/settings'), { section: 'settings' })
    assert.deepEqual(scopeOf('/login'), {})
  })
  it('keeps the section when switching apps, and drops the app for all apps', () => {
    assert.equal(switchHref('/usage', 'blog'), '/blog/usage')
    assert.equal(switchHref('/blog/settings'), '/settings')
    assert.equal(switchHref('/blog/edit', 'shop'), '/shop')
    assert.equal(switchHref('/', 'shop'), '/shop')
  })
  it('titles pages by section', () => {
    assert.equal(titleFor('/'), 'Apps')
    assert.equal(titleFor('/blog'), 'Overview')
    assert.equal(titleFor('/blog/backups'), 'Backups')
    assert.equal(titleFor('/new'), 'New app')
  })
  it('sends old /apps links to the new ones', () => {
    assert.equal(movedHref('blog', null), '/blog')
    assert.equal(movedHref('blog', 'usage'), '/blog/usage')
    assert.equal(movedHref('blog/edit', null), '/blog/edit')
    assert.equal(movedHref('new', null), '/new')
  })
})
