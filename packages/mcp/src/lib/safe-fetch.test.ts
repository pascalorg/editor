import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import type { LookupAddress } from 'node:dns'
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { ProtocolError } from '@modelcontextprotocol/server'
import {
  isBlockedAddress,
  type PinnedRequestInit,
  pinnedLookup,
  type SafeFetchDeps,
  safeFetch,
} from './safe-fetch'

const PUBLIC_V4 = '203.0.113.10'
const PUBLIC_V6 = '2606:4700::1111'

function response(
  status: number,
  headers: Record<string, string> = {},
  body = '',
): IncomingMessage {
  const res = Readable.from(body ? [Buffer.from(body)] : []) as unknown as IncomingMessage
  Object.assign(res, { statusCode: status, statusMessage: '', headers })
  return res
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
    ['other special use', ['192.0.0.1', '198.18.0.1', '100::1', 'fec0::1']],
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
      'http://localhost:9999/',
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
