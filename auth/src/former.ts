import { createHmac, timingSafeEqual } from 'node:crypto'
import type pg from 'pg'

/**
 * Session cookies signed with a former secret: an app that kept its own guests with
 * `@spotcraft/kit` signed them with its own AUTH_SECRET. When the app moves into the pool, its
 * guests and sessions come along with the same tokens, and its secret goes into
 * `auth.former_secrets`. The pool then re-signs such a cookie with its own secret before Better
 * Auth reads it, and sends the browser the re-signed one, so the guest keeps their session.
 */

/** Better Auth's session cookie, on https and on http (a local stack). */
const SESSION_COOKIES = new Set(['__Secure-better-auth.session_token', 'better-auth.session_token'])

/** A year, as the pool's own sessions; renewed on use like them. */
const MAX_AGE = 365 * 24 * 60 * 60

/** Better Auth's (better-call's) signature: base64 HMAC-SHA256 of the token. */
const signature = (token: string, secret: string) =>
  createHmac('sha256', secret).update(token).digest('base64')

const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * For a request's `Cookie` header: when its session cookie is signed with one of `former`
 * rather than `secret`, the header with that cookie re-signed, and the `Set-Cookie` that gives
 * the browser the re-signed one. Undefined when there is nothing to re-sign.
 */
export function resign(
  header: string | undefined,
  secret: string,
  former: readonly string[],
): { cookie: string; setCookie: string } | undefined {
  if (!header || former.length === 0) return undefined
  const parts = header.split(';').map((part) => part.trim())
  for (const [index, part] of parts.entries()) {
    const eq = part.indexOf('=')
    const name = part.slice(0, eq)
    if (eq < 1 || !SESSION_COOKIES.has(name)) continue
    let value: string
    try {
      value = decodeURIComponent(part.slice(eq + 1))
    } catch {
      return undefined
    }
    const dot = value.lastIndexOf('.')
    const token = value.slice(0, dot)
    const signed = value.slice(dot + 1)
    if (dot < 1 || signed.length !== 44 || same(signed, signature(token, secret))) return undefined
    if (!former.some((old) => same(signed, signature(token, old)))) return undefined
    const fresh = `${name}=${encodeURIComponent(`${token}.${signature(token, secret)}`)}`
    parts[index] = fresh
    const secure = name.startsWith('__Secure-') ? '; Secure' : ''
    return {
      cookie: parts.join('; '),
      setCookie: `${fresh}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; SameSite=Lax${secure}`,
    }
  }
  return undefined
}

/**
 * The former secrets in `auth.former_secrets`, read again at most once a minute. A move adds
 * one; until it is read, that app's old cookies wait at most a minute.
 */
export function formerSecrets(db: pg.Pool, ttlMs = 60_000): () => Promise<string[]> {
  let cached: { secrets: string[]; until: number } | undefined
  return async () => {
    if (cached && cached.until > Date.now()) return cached.secrets
    const { rows } = await db.query<{ secret: string }>('SELECT secret FROM auth.former_secrets')
    cached = { secrets: rows.map((row) => row.secret), until: Date.now() + ttlMs }
    return cached.secrets
  }
}
