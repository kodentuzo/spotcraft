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

describe('usage chart', async () => {
  const { axis, change, fillDays, lastDays } = await import('../src/lib/usage.ts')
  it('lists the last days in UTC, today last, and fills the gaps with 0', () => {
    const days = lastDays(3, Date.parse('2026-11-19T10:00:00Z'))
    assert.deepEqual(days, ['2026-11-17', '2026-11-18', '2026-11-19'])
    assert.deepEqual(fillDays(days, [{ day: '2026-11-18', value: 4 }]), [
      { day: '2026-11-17', value: 0 },
      { day: '2026-11-18', value: 4 },
      { day: '2026-11-19', value: 0 },
    ])
  })
  it('compares with the period before only when there was one', () => {
    assert.equal(change(13, 27), -52)
    assert.equal(change(5, 0), null)
    assert.equal(change(null, 4), null)
  })
  it('rounds the axis to whole steps', () => {
    assert.deepEqual(axis(2), { top: 3, step: 1 })
    assert.deepEqual(axis(13), { top: 15, step: 5 })
    assert.deepEqual(axis(240), { top: 300, step: 100 })
  })
})

describe('usage across apps', () => {
  it('adds every app up per day, ignoring days outside the week', async () => {
    const { sumDays } = await import('../src/lib/usage.ts')
    const days = ['2026-11-18', '2026-11-19']
    const a = [
      { day: '2026-11-18', value: 2 },
      { day: '2026-11-10', value: 99 },
    ]
    const b = [
      { day: '2026-11-18', value: 1 },
      { day: '2026-11-19', value: 4 },
    ]
    assert.deepEqual(sumDays(days, [a, b]), [
      { day: '2026-11-18', value: 3 },
      { day: '2026-11-19', value: 4 },
    ])
  })
})
