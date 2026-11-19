import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseAppForm } from '../src/lib/server/app-form.ts'
import { probeTargets } from '../src/lib/server/probe-targets.ts'

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}
const base = { name: 'blog', image: 'vindotski/blog', tag: '1.0.0' }
const parse = (fields: Record<string, string>, domainRequired = false) =>
  parseAppForm(form({ ...base, ...fields }), { withName: true, domainRequired })

describe('app form', () => {
  it('turns a valid form into the agent input, with defaults', () => {
    const { errors, input } = parse({ env: 'A=1\n# comment\n\nB=two=parts', takeOver: 'on' })
    assert.deepEqual(errors, {})
    assert.deepEqual(input?.env, { A: '1', B: 'two=parts' })
    assert.equal(input?.port, 3000)
    assert.equal(input?.memory, '512m')
    assert.equal(input?.takeOver, true)
    assert.equal(input?.readOnly, false, 'an unticked box is off')
  })

  it("refuses bad env lines, reserved names and Spotcraft's env names", () => {
    assert.match(parse({ env: 'OK=1\nnot a pair' }).errors.env ?? '', /Line 2/)
    assert.match(parse({ name: 'postgres' }).errors.name ?? '', /reserved/)
    assert.match(parse({ name: 'auth' }).errors.name ?? '', /reserved/)
    assert.match(parse({ env: 'DATABASE_URL=x' }).errors.env ?? '', /Spotcraft sets it/)
    assert.match(
      parse({ env: 'PORT=1\nAUTH_URL=y' }).errors.env ?? '',
      /Remove PORT, AUTH_URL: Spotcraft sets them/,
    )
    assert.equal(parse({ env: 'AUTH_SECRET=the-app-own' }).errors.env, undefined)
  })

  it('needs a domain only without an apps domain', () => {
    assert.equal(parse({}, false).errors.domain, undefined)
    assert.ok(parse({}, true).errors.domain)
    assert.ok(parse({ domain: 'https://example.com' }).errors.domain)
  })
})

describe('probe targets', () => {
  it('probes every host over HTTPS, and protected apps with the Access module', () => {
    assert.deepEqual(
      probeTargets([
        { name: 'blog', hostnames: ['blog.example.com', 'blog.app'], protected: false },
        { name: 'admin', hostnames: ['admin.example.com'], protected: true },
      ]),
      [
        { targets: ['https://blog.example.com', 'https://blog.app'], labels: { app: 'blog' } },
        {
          targets: ['https://admin.example.com'],
          labels: { app: 'admin', module: 'http_access' },
        },
      ],
    )
  })
})
