import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { capitalized, countryName, flag, share } from '../src/lib/breakdown.ts'

describe('usage breakdowns', () => {
  it('turns a country code into its flag and name', () => {
    assert.equal(flag('HR'), '🇭🇷')
    assert.equal(countryName('HR'), 'Croatia')
    assert.equal(flag('(unknown)'), '')
    assert.equal(countryName('(unknown)'), '(unknown)')
  })
  it('shows shares as whole percentages, and 0 without a total', () => {
    assert.equal(share(9, 13), 69)
    assert.equal(share(1, 0), 0)
    assert.equal(capitalized('desktop'), 'Desktop')
  })
})
