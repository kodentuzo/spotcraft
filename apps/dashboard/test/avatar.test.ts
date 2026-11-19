import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { gravatarUrl } from '../src/lib/server/avatar.ts'

describe('avatar', () => {
  it('addresses Gravatar by the hash of the normalised email, never the email', () => {
    const url = gravatarUrl(' Someone@Example.com ')
    assert.equal(url, gravatarUrl('someone@example.com'))
    assert.match(url, /^https:\/\/gravatar\.com\/avatar\/[0-9a-f]{64}\?s=64&d=404$/)
    assert.ok(!url.includes('example'))
  })
})
