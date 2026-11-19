import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AppStatus } from '@spotcraft/agent/apps'
import { specOf } from '../src/lib/spec.ts'

describe('redeploy', () => {
  it('sends back only the settings, never what the agent reports about the app', () => {
    const app: AppStatus = {
      name: 'blog',
      image: 'me/blog',
      tag: '1.0.0',
      port: 3000,
      env: {},
      memory: '512m',
      cpus: 1,
      readOnly: true,
      database: true,
      state: 'running',
      health: 'healthy',
      status: 'Up 2 hours (healthy)',
      hostnames: ['blog.example.com'],
      lastDeploy: { at: '2026-11-19T10:00:00Z', tag: '1.0.0', ok: true },
    }
    assert.deepEqual(Object.keys(specOf(app)).sort(), [
      'cpus',
      'database',
      'env',
      'image',
      'memory',
      'port',
      'readOnly',
      'tag',
    ])
  })
})
