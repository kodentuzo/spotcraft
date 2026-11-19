import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { appDatabaseName } from 'spotcraft/provision'
import { NAME } from '../src/app-spec.ts'

// The agent and provisioning (in the CLI package) each check app names. They must agree:
// a name the agent accepts but provisioning refuses would deploy an app that can't get a database.
describe('app names', () => {
  it('are accepted by the agent and provisioning alike', () => {
    const agent = new RegExp(NAME)
    const kitAccepts = (name: string) => {
      try {
        appDatabaseName(name)
        return true
      } catch {
        return false
      }
    }
    const samples = [
      'ab',
      'blog',
      'my-app',
      'a1',
      `a${'b'.repeat(30)}c`,
      `a${'b'.repeat(31)}c`,
      'a',
      '1app',
      'app-',
      '-app',
      'App',
      'my_app',
      'my.app',
      'blog?purge=true',
    ]
    for (const name of samples) assert.equal(kitAccepts(name), agent.test(name), name)
  })
})
