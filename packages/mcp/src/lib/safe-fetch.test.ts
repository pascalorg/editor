import { afterEach, beforeEach, describe, expect, jest, mock, spyOn, test } from 'bun:test'
import type { LookupAddress } from 'node:dns'
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { ProtocolError } from '@modelcontextprotocol/server'
import { __resetAllowedOriginsCacheForTests } from '@pascal-app/core/schema'
import {
  isBlockedAddress,
  type PinnedRequestInit,
  pinnedLookup,
  type SafeFetchDeps,
  safeFetch,
} from './safe-fetch'

const PUBLIC_V4 = '93.184.215.14'
const PUBLIC_V6 = '2606:4700::1111'

function response(
  status: number,
  headers: Record<string, string> = {},
  body = '',
  statusMessage = '',
): IncomingMessage {
  const res = Readable.from(body ? [Buffer.from(body)] : []) as unknown as IncomingMessage
  Object.assign(res, { statusCode: status, statusMessage, headers })
  return res
}

/** A 16 MB response body that records how many bytes anyone pulled from it. */
function largeResponse(status: number, headers: Record<string, string> = {}) {
  const chunk = Buffer.alloc(64 * 1024)
  let remaining = 256
  const state = { bytesRead: 0, res: null as unknown as IncomingMessage }
  state.res = new Readable({
    read() {
      if (remaining-- <= 0) return this.push(null)
      state.bytesRead += chunk.byteLength
      this.push(chunk)
    },
  }) as unknown as IncomingMessage
  Object.assign(state.res, { statusCode: status, statusMessage: '', headers })
  return state
}

/** Fake network: `dns` maps hostnames to answers, `routes` maps URLs to responses. */
function fakeNetwork(
  dns: Record<string, string[] | (() => string[])>,
  routes: Record<string, () => IncomingMessage> = {},
) {
  const resolved: string[] = []
  const requests: { url: string; init: PinnedRequestInit }[] = []
  const deps: SafeFetchDeps = {
    resolve: async (hostname) => {
      resolved.push(hostname)
      const answer = dns[hostname]
      if (!answer) throw new Error(`ENOTFOUND ${hostname}`)
      const list = typeof answer === 'function' ? answer() : answer
      return list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
    },
    request: async (url, init) => {
      requests.push({ url: url.toString(), init })
      const route = routes[url.toString()]
      return route ? route() : response(404)
    },
  }
  return { deps, resolved, requests }
}

function lookupAll(init: PinnedRequestInit, family = 0): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) =>
    init.lookup('ignored', { all: true, family }, (err, addresses) =>
      err ? reject(err) : resolve(addresses as LookupAddress[]),
    ),
  )
}

async function expectBlocked(promise: Promise<unknown>, reason = 'url_host_blocked') {
  const err = await promise.catch((e) => e)
  expect(err).toBeInstanceOf(ProtocolError)
  expect((err as Error).message).toContain(reason)
}

let errorLog: ReturnType<typeof spyOn>
beforeEach(() => {
  errorLog = spyOn(console, 'error').mockImplementation(() => {})
  __resetAllowedOriginsCacheForTests()
})
afterEach(() => {
  errorLog.mockRestore()
})

describe('isBlockedAddress', () => {
  const cases: [string, string[]][] = [
    ['loopback', ['127.0.0.1', '127.255.0.9', '::1']],
    ['unspecified / this network', ['0.0.0.0', '0.1.2.3', '::']],
    [
      'private',
      ['10.0.0.1', '172.16.5.9', '172.31.255.254', '192.168.1.1', 'fc00::1', 'fd12:3456::1'],
    ],
    ['link-local and metadata', ['169.254.169.254', '169.254.0.1', 'fe80::1', 'fd00:ec2::254']],
    ['CGNAT 100.64.0.0/10', ['100.64.0.1', '100.100.100.200', '100.127.255.255']],
    ['NAT64', ['64:ff9b::7f00:1', '64:ff9b::808:808', '64:ff9b:1::1']],
    ['IPv4-mapped, dotted', ['::ffff:127.0.0.1', '::ffff:169.254.169.254', '::FFFF:10.0.0.1']],
    ['IPv4-mapped, hex', ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:c0a8:101']],
    ['IPv4-compatible and translated', ['::7f00:1', '::127.0.0.1', '::ffff:0:a00:1']],
    ['6to4 and Teredo', ['2002:7f00:1::', '2002:a9fe:a9fe::1', '2001:0:4136:e378::1']],
    ['multicast / reserved / broadcast', ['224.0.0.1', '240.0.0.1', '255.255.255.255', 'ff02::1']],
    ['other special use', ['192.0.0.1', '192.0.0.255', '198.18.0.1', '100::1', 'fec0::1']],
    [
      'documentation and test nets',
      ['192.0.2.1', '198.51.100.7', '203.0.113.10', '2001:db8::1', '3fff:fff::1'],
    ],
    [
      'other non-global IANA special-purpose',
      ['192.88.99.1', '100:0:0:1::1', '2001:2::1', '5f00::1', '2002:c000:201::'],
    ],
    [
      'IETF protocol assignments 2001::/23',
      [
        '2001:1::',
        '2001:1::4',
        '2001:1::1:1',
        '2001:4::1',
        '2001:5::1',
        '2001:10::1',
        '2001:1ff::1',
      ],
    ],
    ['zone ids and brackets', ['fe80::1%eth0', '[::1]', '[::ffff:7f00:1]']],
    ['not an address', ['', 'example.com', '1.2.3', '::ffff:1.2.3.4.5']],
  ]
  for (const [name, addresses] of cases) {
    test(`blocks ${name}`, () => {
      for (const address of addresses)
        expect([address, isBlockedAddress(address)]).toEqual([address, true])
    })
  }

  test('allows public addresses', () => {
    for (const address of [
      '8.8.8.8',
      PUBLIC_V4,
      '100.63.255.255',
      '100.128.0.1',
      '172.32.0.1',
      '::ffff:8.8.8.8',
      '::ffff:808:808',
      '2002:808:808::1',
      PUBLIC_V6,
      // Only 192.0.0.0/24 and 192.0.2.0/24 are reserved within 192.0.0.0/16.
      '192.0.1.1',
      '192.0.3.1',
      '192.0.255.1',
      // Globally reachable entries in the special-purpose registries.
      '192.31.196.1',
      '192.52.193.1',
      '192.175.48.1',
      '2001:4:112::1',
      '3fff:1000::1',
      // Globally reachable exceptions inside 2001::/23, and the first address past it.
      '2001:1::1',
      '2001:1::2',
      '2001:1::3',
      '2001:3::1',
      '2001:20::1',
      '2001:2f:ffff::1',
      '2001:30::1',
      '2001:3f::1',
      '2001:200::1',
    ]) {
      expect([address, isBlockedAddress(address)]).toEqual([address, false])
    }
  })
})

describe('safeFetch — SSRF protection', () => {
  test('rejects non-http schemes', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)']) {
      await expectBlocked(safeFetch(url), 'url_scheme_not_allowed')
    }
  })

  test('rejects literal addresses in every encoding the URL parser accepts', async () => {
    const { deps, requests } = fakeNetwork({})
    for (const url of [
      'http://127.0.0.1/',
      'http://127.1.2.3/',
      'http://2130706433/', // decimal 127.0.0.1
      'http://0x7f.1/', // hex + short form
      'http://0177.0.0.1/', // octal
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/', // URL parser rewrites to [::ffff:7f00:1]
      'http://[::ffff:a9fe:a9fe]/',
      'http://[64:ff9b::169.254.169.254]/',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.100.100.200/',
      'http://10.0.0.1/',
      'http://[fd00:ec2::254]/',
    ]) {
      await expectBlocked(safeFetch(url, {}, deps))
    }
    expect(requests).toHaveLength(0)
  })

  test('rejects local-style hostnames without resolving them', async () => {
    const { deps, resolved } = fakeNetwork({})
    for (const url of [
      'http://localhost/',
      'http://localhost./',
      'http://mything.local/',
      'http://server.internal/',
      'http://metadata.google.internal/',
      'http://db.corp/',
      'http://nope.localhost/',
    ]) {
      await expectBlocked(safeFetch(url, {}, deps))
    }
    expect(resolved).toHaveLength(0)
  })

  test('rejects a hostname that resolves to a private address', async () => {
    const { deps, requests } = fakeNetwork({
      'a.example': ['127.0.0.1'],
      'b.example': ['::ffff:7f00:1'],
      'c.example': ['64:ff9b::a9fe:a9fe'],
      'd.example': ['100.64.1.1'],
    })
    for (const host of ['a', 'b', 'c', 'd']) {
      await expectBlocked(safeFetch(`http://${host}.example/`, {}, deps))
    }
    expect(requests).toHaveLength(0)
  })

  test('rejects a hostname when any one of its addresses is private', async () => {
    const { deps, requests } = fakeNetwork({ 'mixed.example': [PUBLIC_V4, PUBLIC_V6, '10.1.2.3'] })
    await expectBlocked(safeFetch('http://mixed.example/', {}, deps))
    expect(requests).toHaveLength(0)
  })

  test('surfaces DNS failures as dns_lookup_failed', async () => {
    const { deps } = fakeNetwork({ 'empty.example': [] })
    await expectBlocked(safeFetch('http://missing.example/', {}, deps), 'dns_lookup_failed')
    await expectBlocked(safeFetch('http://empty.example/', {}, deps), 'dns_lookup_failed')
  })

  test('pins the connection to the checked addresses even if DNS changes afterwards', async () => {
    let calls = 0
    const { deps, resolved, requests } = fakeNetwork(
      { 'rebind.example': () => (calls++ === 0 ? [PUBLIC_V4, PUBLIC_V6] : ['127.0.0.1']) },
      {
        'http://rebind.example/img.png': () =>
          response(200, { 'content-type': 'image/png' }, 'png'),
      },
    )
    const result = await safeFetch('http://rebind.example/img.png', {}, deps)
    expect(result.buffer.toString()).toBe('png')
    expect(result.contentType).toBe('image/png')
    expect(resolved).toEqual(['rebind.example'])
    const init = requests[0]!.init
    expect(await lookupAll(init)).toEqual([
      { address: PUBLIC_V4, family: 4 },
      { address: PUBLIC_V6, family: 6 },
    ])
    expect(await lookupAll(init, 6)).toEqual([{ address: PUBLIC_V6, family: 6 }])
  })

  test('re-resolves and rechecks every redirect hop', async () => {
    const { deps, resolved, requests } = fakeNetwork(
      { 'cdn.example': [PUBLIC_V4], 'evil.example': ['169.254.169.254'] },
      {
        'http://cdn.example/a': () => response(302, { location: 'http://evil.example/b' }),
        'http://cdn.example/c': () => response(301, { location: 'http://[::ffff:7f00:1]/' }),
        'http://cdn.example/d': () => response(307, { location: 'file:///etc/passwd' }),
      },
    )
    await expectBlocked(safeFetch('http://cdn.example/a', {}, deps))
    await expectBlocked(safeFetch('http://cdn.example/c', {}, deps))
    await expectBlocked(safeFetch('http://cdn.example/d', {}, deps), 'url_scheme_not_allowed')
    expect(resolved).toEqual(['cdn.example', 'evil.example', 'cdn.example', 'cdn.example'])
    expect(requests.map((r) => r.url)).toEqual([
      'http://cdn.example/a',
      'http://cdn.example/c',
      'http://cdn.example/d',
    ])
  })

  test('follows a redirect to another public host', async () => {
    const { deps } = fakeNetwork(
      { 'a.example': [PUBLIC_V4], 'b.example': [PUBLIC_V6] },
      {
        'https://a.example/x': () => response(302, { location: 'https://b.example/y' }),
        'https://b.example/y': () => response(200, {}, 'ok'),
      },
    )
    const result = await safeFetch('https://a.example/x', {}, deps)
    expect(result.finalUrl).toBe('https://b.example/y')
    expect(result.hops).toEqual(['https://a.example/x', 'https://b.example/y'])
  })

  test('enforces the body size cap', async () => {
    const { deps } = fakeNetwork(
      { 'big.example': [PUBLIC_V4] },
      {
        'http://big.example/declared': () => response(200, { 'content-length': '100' }),
        'http://big.example/streamed': () => response(200, {}, 'x'.repeat(100)),
      },
    )
    await expectBlocked(
      safeFetch('http://big.example/declared', { maxBytes: 10 }, deps),
      'response_too_large',
    )
    await expectBlocked(
      safeFetch('http://big.example/streamed', { maxBytes: 10 }, deps),
      'response_too_large',
    )
  })

  test('logs every blocked fetch', async () => {
    const { deps } = fakeNetwork({ 'a.example': ['10.0.0.7'] })
    await expectBlocked(safeFetch('http://a.example/', {}, deps))
    await expectBlocked(safeFetch('gopher://a.example/'), 'url_scheme_not_allowed')
    const lines = errorLog.mock.calls.map((args) => String(args[0]))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toStartWith('[pascal-mcp] safe_fetch_blocked ')
    expect(JSON.parse(lines[0]!.slice(lines[0]!.indexOf('{')))).toMatchObject({
      reason: 'url_host_blocked',
      hostname: 'a.example',
      address: '10.0.0.7',
    })
    expect(lines[1]).toContain('"reason":"url_scheme_not_allowed"')
  })

  test('logs blocked URLs without query, fragment or userinfo', async () => {
    const { deps } = fakeNetwork({ 'a.example': ['10.0.0.7'] })
    const query = '?X-Amz-Signature=s3cr3t&token=t0k3n#frag'
    const secretUrl = (scheme: string) => `${scheme}://a.example/img.png${query}`
    await expectBlocked(safeFetch(secretUrl('http'), {}, deps))
    await expectBlocked(safeFetch(secretUrl('ftp')), 'url_scheme_not_allowed')
    await expectBlocked(
      safeFetch(`https://user:hunter2@a.example/img.png${query}`),
      'url_credentials_not_allowed',
    )
    await withAllowlist('https://cdn.example.com', () =>
      expectBlocked(safeFetch(secretUrl('https')), 'url_origin_not_allowlisted'),
    )
    const lines = errorLog.mock.calls.map((args) => String(args[0]))
    expect(lines).toHaveLength(4)
    const logged = lines.map((line) => JSON.parse(line.slice(line.indexOf('{'))).url)
    expect(logged).toEqual([
      'http://a.example/img.png',
      'ftp://a.example',
      'https://a.example/img.png',
      'https://a.example/img.png',
    ])
    for (const line of lines) {
      for (const secret of ['s3cr3t', 't0k3n', 'frag', 'hunter2', 'user', '?']) {
        expect(line).not.toContain(secret)
      }
    }
  })

  test('truncates long logged paths and logs only scheme and host for other schemes', async () => {
    const { deps } = fakeNetwork({ 'a.example': ['10.0.0.7'] })
    const longPath = `/${'p'.repeat(500)}`
    await expectBlocked(safeFetch(`http://a.example${longPath}`, {}, deps))
    await expectBlocked(
      safeFetch(`data:image/png;base64,${'A'.repeat(500)}`),
      'url_scheme_not_allowed',
    )
    await expectBlocked(safeFetch('javascript:alert(document.cookie)'), 'url_scheme_not_allowed')
    const logged = errorLog.mock.calls.map((args) => {
      const line = String(args[0])
      return JSON.parse(line.slice(line.indexOf('{'))).url as string
    })
    expect(logged).toEqual([`http://a.example${longPath.slice(0, 128)}…`, 'data:', 'javascript:'])
  })

  test('only web ports are fetched unless the origin is allowlisted', async () => {
    const { deps, resolved } = fakeNetwork(
      { 'a.example': [PUBLIC_V4], 'cdn.example': [PUBLIC_V4] },
      {
        'http://a.example/x': () => response(200, {}, 'http'),
        'https://a.example/x': () => response(200, {}, 'https'),
        'http://a.example:443/x': () => response(200, {}, 'http-on-443'),
        'https://cdn.example:8443/x': () => response(200, {}, 'allowlisted'),
      },
    )
    for (const url of [
      'http://a.example:8080/x',
      'https://a.example:22/x',
      'http://a.example:6379/',
    ]) {
      await expectBlocked(safeFetch(url, {}, deps), 'url_port_not_allowed')
    }
    expect(resolved).toHaveLength(0)
    for (const [url, body] of [
      ['http://a.example:80/x', 'http'],
      ['https://a.example:443/x', 'https'],
      ['http://a.example:443/x', 'http-on-443'],
    ]) {
      expect((await safeFetch(url!, {}, deps)).buffer.toString()).toBe(body!)
    }

    const prev = process.env.PASCAL_ALLOWED_ASSET_ORIGINS
    process.env.PASCAL_ALLOWED_ASSET_ORIGINS = 'https://cdn.example:8443'
    try {
      const result = await safeFetch('https://cdn.example:8443/x', {}, deps)
      expect(result.buffer.toString()).toBe('allowlisted')
    } finally {
      if (prev === undefined) delete process.env.PASCAL_ALLOWED_ASSET_ORIGINS
      else process.env.PASCAL_ALLOWED_ASSET_ORIGINS = prev
    }
  })

  test('a DNS lookup that never answers still times out', async () => {
    jest.useFakeTimers()
    try {
      const { deps, resolved, requests } = fakeNetwork({})
      deps.resolve = (hostname) => {
        resolved.push(hostname)
        return new Promise(() => {})
      }
      const pending = safeFetch('https://hang.example/x', { timeoutMs: 5_000 }, deps).catch(
        (e) => e,
      )
      await Promise.resolve()
      expect(resolved).toEqual(['hang.example'])
      jest.advanceTimersByTime(5_000)
      const err = await pending
      expect(err).toBeInstanceOf(ProtocolError)
      expect((err as Error).message).toContain('fetch_timeout')
      expect(requests).toHaveLength(0)
    } finally {
      jest.useRealTimers()
    }
  })

  test('never reads redirect or error bodies', async () => {
    const redirect = largeResponse(302, { location: 'http://b.example/final' })
    const failure = largeResponse(500)
    const { deps } = fakeNetwork(
      { 'a.example': [PUBLIC_V4], 'b.example': [PUBLIC_V4] },
      {
        'http://a.example/redirect': () => redirect.res,
        'http://b.example/final': () => response(200, {}, 'ok'),
        'http://a.example/error': () => failure.res,
      },
    )
    const result = await safeFetch('http://a.example/redirect', {}, deps)
    expect(result.buffer.toString()).toBe('ok')
    await expectBlocked(safeFetch('http://a.example/error', {}, deps), 'fetch_failed')
    // Settles on destroy, or only after a full drain if the body were read.
    await Promise.all([redirect.res, failure.res].map((res) => finished(res).catch(() => {})))
    expect(redirect.res.destroyed).toBe(true)
    expect(failure.res.destroyed).toBe(true)
    expect(redirect.bytesRead).toBe(0)
    expect(failure.bytesRead).toBe(0)
  })

  test('rejects malformed URL', async () => {
    await expectBlocked(safeFetch('not a url'), 'invalid_url')
  })

  test('applies PASCAL_ALLOWED_ASSET_ORIGINS env allowlist when set', async () => {
    const prev = process.env.PASCAL_ALLOWED_ASSET_ORIGINS
    process.env.PASCAL_ALLOWED_ASSET_ORIGINS = 'https://cdn.example.com'
    try {
      await expectBlocked(
        safeFetch('https://other.example.com/x.png'),
        'url_origin_not_allowlisted',
      )
    } finally {
      if (prev === undefined) {
        delete process.env.PASCAL_ALLOWED_ASSET_ORIGINS
      } else {
        process.env.PASCAL_ALLOWED_ASSET_ORIGINS = prev
      }
    }
  })
})

async function withAllowlist<T>(value: string, run: () => Promise<T>): Promise<T> {
  const prev = process.env.PASCAL_ALLOWED_ASSET_ORIGINS
  process.env.PASCAL_ALLOWED_ASSET_ORIGINS = value
  try {
    return await run()
  } finally {
    if (prev === undefined) delete process.env.PASCAL_ALLOWED_ASSET_ORIGINS
    else process.env.PASCAL_ALLOWED_ASSET_ORIGINS = prev
  }
}

describe('safeFetch — origin allowlist', () => {
  const routes = {
    'https://cdn.example.com/x': () => response(200, {}, 'cdn'),
    'https://cdn.example.com:8443/x': () => response(200, {}, 'cdn-8443'),
  }
  const dns = {
    'cdn.example.com': [PUBLIC_V4],
    'cdn.example.com.evil.example': [PUBLIC_V4],
    'evilcdn.example.com': [PUBLIC_V4],
    'cdn.example.co': [PUBLIC_V4],
  }

  test('entries match after normalisation (default port, case, trailing slash, path)', async () => {
    for (const entry of [
      'https://cdn.example.com:443',
      'HTTPS://CDN.Example.COM',
      'https://cdn.example.com/',
      ' https://cdn.example.com/assets/ ',
    ]) {
      const { deps } = fakeNetwork(dns, routes)
      const result = await withAllowlist(entry, () =>
        safeFetch('https://cdn.example.com/x', {}, deps),
      )
      expect([entry, result.buffer.toString()]).toEqual([entry, 'cdn'])
    }
  })

  test('rejected entries are skipped and logged by index and reason, never by value', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { deps } = fakeNetwork(dns, routes)
      const raw =
        'cdn.example.com, not a url,https://cdn.example.com,user:hunter2@cdn.example.com, ftp://user:hunter2@cdn.example.com'
      await withAllowlist(raw, async () => {
        expect((await safeFetch('https://cdn.example.com/x', {}, deps)).buffer.toString()).toBe(
          'cdn',
        )
        await safeFetch('https://cdn.example.com/x', {}, deps)
      })
      const lines = warn.mock.calls.map((args) => String(args[0]))
      expect(lines).toEqual([
        '[pascal] asset_allowlist_entry_ignored {"index":0,"reason":"not_a_url"}',
        '[pascal] asset_allowlist_entry_ignored {"index":1,"reason":"not_a_url"}',
        '[pascal] asset_allowlist_entry_ignored {"index":3,"reason":"scheme_not_allowed"}',
        '[pascal] asset_allowlist_entry_ignored {"index":4,"reason":"scheme_not_allowed"}',
      ])
      for (const line of [...lines, ...errorLog.mock.calls.map((args) => String(args[0]))]) {
        expect(line).not.toContain('hunter2')
      }
    } finally {
      warn.mockRestore()
    }
  })

  test('an allowlist with no valid entry, or only whitespace, blocks everything', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { deps, resolved } = fakeNetwork(dns, routes)
      for (const value of ['cdn.example.com', '  ', ' , ', 'blob:https://cdn.example.com/x']) {
        await withAllowlist(value, () =>
          expectBlocked(
            safeFetch('https://cdn.example.com/x', {}, deps),
            'url_origin_not_allowlisted',
          ),
        )
      }
      expect(resolved).toHaveLength(0)
    } finally {
      warn.mockRestore()
    }
  })

  test('near-miss origins are not allowlisted', async () => {
    const { deps, resolved } = fakeNetwork(dns, routes)
    await withAllowlist('https://cdn.example.com', async () => {
      for (const url of [
        'https://cdn.example.com.evil.example/x', // suffix host
        'https://evilcdn.example.com/x', // prefix host
        'https://cdn.example.co/x', // truncated host
        'https://cdn.example.com:8443/x', // different port
        'http://cdn.example.com/x', // different scheme
      ]) {
        await expectBlocked(safeFetch(url, {}, deps), 'url_origin_not_allowlisted')
      }
    })
    await withAllowlist('https://cdn.example.com:8443', async () => {
      await expectBlocked(
        safeFetch('https://cdn.example.com/x', {}, deps),
        'url_origin_not_allowlisted',
      )
      expect((await safeFetch('https://cdn.example.com:8443/x', {}, deps)).buffer.toString()).toBe(
        'cdn-8443',
      )
    })
    expect(resolved).toEqual(['cdn.example.com'])
  })
})

describe('safeFetch — ports and redirects', () => {
  test('a redirect hop to a forbidden port is blocked before it is resolved', async () => {
    const { deps, resolved, requests } = fakeNetwork(
      { 'a.example': [PUBLIC_V4], 'b.example': [PUBLIC_V4] },
      { 'https://a.example/x': () => response(302, { location: 'https://b.example:8080/y' }) },
    )
    await expectBlocked(safeFetch('https://a.example/x', {}, deps), 'url_port_not_allowed')
    expect(resolved).toEqual(['a.example'])
    expect(requests.map((r) => r.url)).toEqual(['https://a.example/x'])
  })

  test('https on port 80 counts as a web port and keeps the explicit port', async () => {
    const { deps, requests } = fakeNetwork(
      { 'a.example': [PUBLIC_V4] },
      { 'https://a.example:80/x': () => response(200, {}, 'tls-on-80') },
    )
    const result = await safeFetch('https://a.example:80/x', {}, deps)
    expect(result.buffer.toString()).toBe('tls-on-80')
    expect(requests.map((r) => r.url)).toEqual(['https://a.example:80/x'])
  })
})

/** One real event-loop turn: lets the runtime report unhandled rejections. */
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('safeFetch — DNS and the timeout', () => {
  test('a DNS answer (even a rebinding to loopback) or failure after the timeout changes nothing', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    jest.useFakeTimers()
    try {
      const answers: {
        resolve: (addresses: LookupAddress[]) => void
        reject: (err: Error) => void
      }[] = []
      const { deps, requests } = fakeNetwork(
        {},
        { 'https://late.example/x': () => response(200, {}, 'too late') },
      )
      deps.resolve = () => new Promise((resolve, reject) => answers.push({ resolve, reject }))
      const answered = safeFetch('https://late.example/x', { timeoutMs: 1_000 }, deps).catch(
        (e) => e,
      )
      const failed = safeFetch('https://late.example/x', { timeoutMs: 1_000 }, deps).catch((e) => e)
      jest.advanceTimersByTime(1_000)
      for (const err of [await answered, await failed]) {
        expect(err).toBeInstanceOf(ProtocolError)
        expect((err as Error).message).toContain('fetch_timeout')
      }
      jest.useRealTimers()
      // A rebinding answer: had safeFetch still been waiting, it would block or pin it.
      answers[0]!.resolve([{ address: '127.0.0.1', family: 4 }])
      answers[1]!.reject(new Error('ENOTFOUND late.example'))
      await nextTurn()
      await nextTurn()
      expect(requests).toHaveLength(0)
      expect(errorLog.mock.calls.map((args) => String(args[0]))).toEqual([])
      expect(unhandled).toEqual([])
    } finally {
      jest.useRealTimers()
      process.off('unhandledRejection', onUnhandled)
    }
  })

  test('the abort listener is gone before the lookup result is used', async () => {
    const added: unknown[] = []
    const removed: unknown[] = []
    const originalAdd = AbortSignal.prototype.addEventListener
    const originalRemove = AbortSignal.prototype.removeEventListener
    const add = spyOn(AbortSignal.prototype, 'addEventListener').mockImplementation(function (
      this: AbortSignal,
      ...args: Parameters<AbortSignal['addEventListener']>
    ) {
      if (args[0] === 'abort') added.push(args[1])
      return originalAdd.apply(this, args)
    })
    const remove = spyOn(AbortSignal.prototype, 'removeEventListener').mockImplementation(function (
      this: AbortSignal,
      ...args: Parameters<AbortSignal['removeEventListener']>
    ) {
      if (args[0] === 'abort') removed.push(args[1])
      return originalRemove.apply(this, args)
    })
    // Listeners still attached at the moment safeFetch first reads each lookup's
    // answer or error: the earliest point the result can be acted on.
    const attachedWhenUsed: number[] = []
    const observe = () => attachedWhenUsed.push(added.length - removed.length)
    const answer = (address: string): LookupAddress => {
      let seen = false
      return {
        get address() {
          if (!seen) observe()
          seen = true
          return address
        },
        family: address.includes(':') ? 6 : 4,
      }
    }
    const failure = () => {
      const err = new Error('ENOTFOUND')
      let seen = false
      Object.defineProperty(err, 'code', {
        get() {
          if (!seen) observe()
          seen = true
          return 'ENOTFOUND'
        },
      })
      return err
    }
    try {
      const { deps } = fakeNetwork(
        {},
        {
          'https://a.example/x': () => response(302, { location: 'https://b.example/y' }),
          'https://b.example/y': () => response(200, {}, 'ok'),
        },
      )
      deps.resolve = async (hostname) => {
        if (hostname === 'a.example') return [answer(PUBLIC_V4)]
        if (hostname === 'b.example') return [answer(PUBLIC_V6)]
        throw failure()
      }
      expect((await safeFetch('https://a.example/x', {}, deps)).buffer.toString()).toBe('ok')
      await expectBlocked(safeFetch('https://missing.example/x', {}, deps), 'dns_lookup_failed')
      expect(added).toHaveLength(3)
      expect(attachedWhenUsed).toEqual([0, 0, 0])
      expect(removed).toEqual(added)
    } finally {
      add.mockRestore()
      remove.mockRestore()
    }
  })
})

describe('pinnedLookup', () => {
  test('a real socket connects to the pinned address, not what DNS says', async () => {
    const server = createServer((req, res) => res.end(`host=${req.headers.host}`))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const lookup = mock(pinnedLookup([{ address: '127.0.0.1', family: 4 }]))
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const req = httpRequest(
          { hostname: 'unresolvable.invalid', port, path: '/', agent: false, lookup },
          (res) => {
            let text = ''
            res.on('data', (chunk) => (text += chunk))
            res.on('end', () => resolve(text))
          },
        )
        req.on('error', reject)
        req.end()
      })
      expect(body).toBe(`host=unresolvable.invalid:${port}`)
      expect(lookup).toHaveBeenCalledTimes(1)
    } finally {
      server.close()
    }
  })

  test('fails when no pinned address matches the requested family', async () => {
    const lookup = pinnedLookup([{ address: PUBLIC_V4, family: 4 }])
    const err = await new Promise((resolve) => lookup('x', { family: 6 }, (e) => resolve(e)))
    expect(err).toBeInstanceOf(Error)
  })
})

describe('safeFetch — request credentials', () => {
  test('URLs with userinfo are refused before any lookup, on the first hop or a redirect', async () => {
    const { deps, resolved, requests } = fakeNetwork(
      { 'a.example': [PUBLIC_V4] },
      { 'https://a.example/r': () => response(302, { location: 'https://u:p@a.example/next' }) },
    )
    for (const url of [
      'https://user:hunter2@a.example/x',
      'https://user@a.example/x',
      'https://:pw@a.example/x',
    ]) {
      await expectBlocked(safeFetch(url, {}, deps), 'url_credentials_not_allowed')
    }
    expect(resolved).toHaveLength(0)
    await expectBlocked(safeFetch('https://a.example/r', {}, deps), 'url_credentials_not_allowed')
    expect(requests.map((r) => r.url)).toEqual(['https://a.example/r'])
  })
})

describe('safeFetch — error data is redacted at the source', () => {
  const Q = '?token=s3cr3t&X-Amz-Signature=s3cr3t#frag'
  const at = (path: string) => `https://a.example${path}${Q}`
  const hanging = (init: PinnedRequestInit) =>
    new Promise<IncomingMessage>((_, reject) =>
      init.signal.addEventListener('abort', () =>
        reject(Object.assign(new Error(`aborted ${at('/x')}`), { name: 'AbortError' })),
      ),
    )
  const net = () => {
    const network = fakeNetwork(
      { 'a.example': [PUBLIC_V4], 'private.example': ['10.0.0.1'], 'empty.example': [] },
      {
        [at('/redirect-nowhere')]: () => response(302),
        [at('/fail')]: () => response(500),
        [at('/echo')]: () => response(403, {}, '', `Forbidden ${at('/echo')} user:hunter2@`),
        [at('/declared')]: () => response(200, { 'content-length': '100' }),
        [at('/streamed')]: () => response(200, {}, 'x'.repeat(100)),
        [at('/loop')]: () => response(302, { location: at('/loop') }),
      },
    )
    const { resolve, request } = network.deps
    network.deps.resolve = async (hostname) => {
      if (hostname === 'gone.example') {
        throw Object.assign(new Error(`getaddrinfo ENOTFOUND gone.example ${Q}`), {
          code: 'ENOTFOUND',
        })
      }
      return resolve(hostname)
    }
    network.deps.request = async (url, init) => {
      if (url.pathname === '/hang') return hanging(init)
      if (url.pathname === '/refused') {
        throw Object.assign(new Error(`connect ECONNREFUSED ${url.toString()}`), {
          code: 'ECONNREFUSED',
        })
      }
      return request(url, init)
    }
    return network.deps
  }

  const cases: [reason: string, run: () => Promise<unknown>][] = [
    ['invalid_url', () => safeFetch(`http://exa mple.com/x${Q}`)],
    ['url_scheme_not_allowed', () => safeFetch(`ftp://a.example/x${Q}`)],
    ['url_credentials_not_allowed', () => safeFetch(`https://user:hunter2@a.example/x${Q}`)],
    [
      'url_origin_not_allowlisted',
      () => withAllowlist('https://cdn.example.com', () => safeFetch(at('/x'))),
    ],
    ['url_port_not_allowed', () => safeFetch(`https://a.example:8080/x${Q}`)],
    ['url_host_blocked', () => safeFetch(`http://localhost/x${Q}`)],
    ['url_host_blocked', () => safeFetch(`https://private.example/x${Q}`, {}, net())],
    ['dns_lookup_failed', () => safeFetch(`https://gone.example/x${Q}`, {}, net())],
    ['dns_lookup_failed', () => safeFetch(`https://empty.example/x${Q}`, {}, net())],
    ['redirect_without_location', () => safeFetch(at('/redirect-nowhere'), {}, net())],
    ['fetch_failed', () => safeFetch(at('/fail'), {}, net())],
    ['fetch_failed', () => safeFetch(at('/echo'), {}, net())],
    ['response_too_large', () => safeFetch(at('/declared'), { maxBytes: 10 }, net())],
    ['response_too_large', () => safeFetch(at('/streamed'), { maxBytes: 10 }, net())],
    ['too_many_redirects', () => safeFetch(at('/loop'), {}, net())],
    ['fetch_error', () => safeFetch(at('/refused'), {}, net())],
    [
      'fetch_timeout',
      async () => {
        jest.useFakeTimers()
        try {
          const pending = safeFetch(at('/hang'), { timeoutMs: 1_000 }, net()).catch((e) => e)
          await Promise.resolve()
          await Promise.resolve()
          jest.advanceTimersByTime(1_000)
          throw await pending
        } finally {
          jest.useRealTimers()
        }
      },
    ],
  ]

  for (const [reason, run] of cases) {
    test(`${reason}: no query string, fragment or userinfo in the error data`, async () => {
      const err = await run().catch((e) => e)
      expect(err).toBeInstanceOf(ProtocolError)
      expect((err as Error).message).toContain(reason)
      const data = JSON.stringify((err as ProtocolError).data)
      for (const leak of ['s3cr3t', 'hunter2', 'token=', '?', '#', '@']) {
        expect([reason, data, data.includes(leak)]).toEqual([reason, data, false])
      }
    })
  }

  test("a failed response reports the standard status text, not the server's reason phrase", async () => {
    const err = await safeFetch(at('/echo'), {}, net()).catch((e) => e)
    expect((err as ProtocolError).data).toEqual({
      url: 'https://a.example/echo',
      status: 403,
      statusText: 'Forbidden',
    })
  })

  test('network failures report a code, not their message', async () => {
    const dns = await safeFetch(`https://gone.example/x${Q}`, {}, net()).catch((e) => e)
    expect((dns as ProtocolError).data).toEqual({
      url: 'https://gone.example/x',
      hostname: 'gone.example',
      code: 'ENOTFOUND',
    })
    const fetchErr = await safeFetch(at('/refused'), {}, net()).catch((e) => e)
    expect((fetchErr as ProtocolError).data).toEqual({
      url: 'https://a.example/refused',
      code: 'ECONNREFUSED',
    })
    const loop = await safeFetch(at('/loop'), {}, net()).catch((e) => e)
    expect((loop as ProtocolError).data).toEqual({
      hops: Array.from({ length: 4 }, () => 'https://a.example/loop'),
    })
  })
})
