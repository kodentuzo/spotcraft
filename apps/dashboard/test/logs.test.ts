import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeLogs } from '../src/lib/logs.ts'

describe('logs of every app', () => {
  it('merges apps by time, keeps continuation lines in place and the newest last', () => {
    const merged = mergeLogs(
      {
        blog: 'blog-blue-1  | 2026-11-19T10:00:02.000Z started\n  at line two\n',
        shop: 'shop-green-1  | 2026-11-19T10:00:01.000Z hello\nshop-green-1  | 2026-11-19T10:00:03.000Z bye',
      },
      3,
    )
    assert.deepEqual(
      merged.map((l) => `${l.app}: ${l.text}`),
      ['blog: started', 'blog:   at line two', 'shop: bye'],
    )
  })
})
