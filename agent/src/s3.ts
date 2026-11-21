import { createHash, createHmac } from 'node:crypto'

/**
 * Just enough of the S3 API to put backups into a bucket: Cloudflare R2, or any other
 * S3-compatible store (ADR 0030). Requests are signed with AWS Signature Version 4.
 */
export interface S3Config {
  /** e.g. https://<account>.r2.cloudflarestorage.com; path-style requests go to it. */
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** R2 takes `auto`. */
  region?: string
}

const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest()

/** RFC 3986 encoding of one path segment, as SigV4 wants it. */
const encodeSegment = (segment: string) =>
  encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )

/**
 * The SigV4 `Authorization` header for a request. `headers` are lower-case and include `host`,
 * `x-amz-date` and `x-amz-content-sha256`; all of them are signed.
 */
export function signV4(request: {
  method: string
  /** Already encoded, e.g. `/bucket/app/2026.dump`. */
  path: string
  query?: string
  headers: Record<string, string>
  payloadHash: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  service?: string
}): string {
  const service = request.service ?? 's3'
  const amzDate = request.headers['x-amz-date']
  if (!amzDate) throw new Error('x-amz-date is required')
  const day = amzDate.slice(0, 8)
  const names = Object.keys(request.headers).sort()
  const canonicalHeaders = names.map((n) => `${n}:${request.headers[n]?.trim()}\n`).join('')
  const signedHeaders = names.join(';')
  const canonicalRequest = [
    request.method,
    request.path,
    request.query ?? '',
    canonicalHeaders,
    signedHeaders,
    request.payloadHash,
  ].join('\n')
  const scope = `${day}/${request.region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const key = hmac(
    hmac(hmac(hmac(`AWS4${request.secretAccessKey}`, day), request.region), service),
    'aws4_request',
  )
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex')
  return `AWS4-HMAC-SHA256 Credential=${request.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

/** `20261114T030000Z`, as x-amz-date wants it. */
export const amzDate = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '')

/** The text between `<tag>` and `</tag>`, for each one in `xml`, XML-unescaped. */
const tags = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((m) =>
    (m[1] ?? '')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&amp;', '&'),
  )

export class S3 {
  readonly #config: S3Config & { region: string }
  readonly #fetch: typeof fetch
  readonly #now: () => Date

  constructor(config: S3Config, fetchImpl: typeof fetch = fetch, now = () => new Date()) {
    this.#config = { region: 'auto', ...config, endpoint: config.endpoint.replace(/\/+$/, '') }
    this.#fetch = fetchImpl
    this.#now = now
  }

  /** A signed request for `key` in the bucket (`''`: the bucket itself); throws unless 2xx. */
  async #request(
    method: 'GET' | 'PUT',
    key: string,
    {
      query = {},
      body,
      contentType,
    }: { query?: Record<string, string>; body?: Uint8Array; contentType?: string } = {},
  ): Promise<Response> {
    const url = new URL(this.#config.endpoint)
    const segments = [this.#config.bucket, ...(key ? key.split('/') : [])]
    const path = `/${segments.map(encodeSegment).join('/')}`
    const search = Object.keys(query)
      .sort()
      .map((name) => `${encodeSegment(name)}=${encodeSegment(query[name] ?? '')}`)
      .join('&')
    const payloadHash = sha256Hex(body ?? '')
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate(this.#now()),
    }
    const authorization = signV4({
      method,
      path,
      query: search,
      headers,
      payloadHash,
      accessKeyId: this.#config.accessKeyId,
      secretAccessKey: this.#config.secretAccessKey,
      region: this.#config.region,
    })
    const { host: _, ...sent } = headers
    const response = await this.#fetch(`${url.origin}${path}${search ? `?${search}` : ''}`, {
      method,
      headers: { ...sent, authorization, ...(contentType ? { 'content-type': contentType } : {}) },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) {
      const text = (await response.text().catch(() => '')).slice(0, 500)
      throw new Error(`The bucket answered ${response.status} for ${key || 'a listing'}: ${text}`)
    }
    return response
  }

  /** Puts one object; throws with S3's answer if it fails. */
  async put(key: string, body: Uint8Array, contentType = 'application/octet-stream') {
    await this.#request('PUT', key, { body, contentType })
  }

  /** One object's bytes; refuses one larger than `maxBytes`. */
  async get(key: string, maxBytes: number): Promise<Buffer> {
    const response = await this.#request('GET', key)
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > maxBytes) {
      await response.body?.cancel()
      throw new Error(`${key} is larger than ${maxBytes / 1024 / 1024} MB`)
    }
    const data = Buffer.from(await response.arrayBuffer())
    if (data.length > maxBytes)
      throw new Error(`${key} is larger than ${maxBytes / 1024 / 1024} MB`)
    return data
  }

  /** The "folders" right under `prefix` (which ends in `/`), such as `blog/20261114T030000Z/`. */
  async folders(prefix: string): Promise<string[]> {
    const found: string[] = []
    let token: string | undefined
    do {
      const query: Record<string, string> = { 'list-type': '2', delimiter: '/', prefix }
      if (token) query['continuation-token'] = token
      const xml = await (await this.#request('GET', '', { query })).text()
      const common = xml.match(/<CommonPrefixes>[\s\S]*?<\/CommonPrefixes>/g) ?? []
      for (const block of common) found.push(...tags(block, 'Prefix'))
      token =
        tags(xml, 'IsTruncated')[0] === 'true' ? tags(xml, 'NextContinuationToken')[0] : undefined
    } while (token)
    return found
  }
}
