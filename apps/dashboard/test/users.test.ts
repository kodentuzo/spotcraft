import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { listErrorMessage } from '../src/lib/users.ts'

describe('users page', () => {
  it("says plainly when the agent is too old to list one app's users", () => {
    const old = new Error('querystring must NOT have additional properties')
    assert.match(listErrorMessage(old, 'blog'), /older than this dashboard/)
    assert.equal(listErrorMessage(old), 'querystring must NOT have additional properties')
    assert.equal(listErrorMessage(new Error('No such app'), 'blog'), 'No such app')
    assert.equal(listErrorMessage('?'), 'The agent could not list the users')
  })
})
