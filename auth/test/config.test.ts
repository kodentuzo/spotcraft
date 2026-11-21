import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadConfig } from '../src/config.ts'

const valid = {
  AUTH_DATABASE_URL: 'postgres://spotcraft_auth:pw@postgres:5432/apps',
  AUTH_SECRET: 'a'.repeat(32),
  AUTH_ISSUER: 'https://auth.example.com/main',
}

describe('settings', () => {
  it('has defaults for everything but the database, secret and issuer', () => {
    const config = loadConfig(valid)
    assert.equal(config.protocol, 'https')
    assert.equal(config.appGroup, 'spotcraft_app')
    assert.equal(config.guestDays, 180)
    assert.equal(config.ipDays, 30)
    assert.equal(config.backupDays, 30)
    assert.deepEqual(config.trustedOrigins, [])
  })

  it('names what is missing or wrong', () => {
    assert.throws(() => loadConfig({ ...valid, AUTH_DATABASE_URL: '' }), /AUTH_DATABASE_URL/)
    assert.throws(() => loadConfig({ ...valid, AUTH_SECRET: 'short' }), /AUTH_SECRET/)
    assert.throws(() => loadConfig({ ...valid, AUTH_ISSUER: 'nope' }), /AUTH_ISSUER/)
    assert.throws(() => loadConfig({ ...valid, AUTH_PROTOCOL: 'ftp' }), /AUTH_PROTOCOL/)
    assert.throws(() => loadConfig({ ...valid, AUTH_GUEST_DAYS: '0' }), /AUTH_GUEST_DAYS/)
    assert.throws(() => loadConfig({ ...valid, AUTH_IP_DAYS: '1.5' }), /AUTH_IP_DAYS/)
    assert.throws(() => loadConfig({ ...valid, AUTH_BACKUP_DAYS: 'x' }), /AUTH_BACKUP_DAYS/)
  })

  it('takes trusted origins as a list of origins only', () => {
    const config = loadConfig({
      ...valid,
      AUTH_TRUSTED_ORIGINS: ' https://a.example.com, https://b.example.com ',
    })
    assert.deepEqual(config.trustedOrigins, ['https://a.example.com', 'https://b.example.com'])
    assert.throws(
      () => loadConfig({ ...valid, AUTH_TRUSTED_ORIGINS: 'https://a.example.com/path' }),
      /not an origin/,
    )
  })
})
