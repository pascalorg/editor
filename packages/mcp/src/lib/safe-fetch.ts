import type { LookupAddress } from 'node:dns'
import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage, STATUS_CODES } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'
import { ALLOWED_ORIGINS_ENV, allowedOriginsFrom } from '@pascal-app/core/schema'

/**
 * SSRF-safe fetch for user-supplied URLs (image URLs in vision tools).
 *
 * Every hop (the initial URL and each redirect target) is checked the same way:
 * - only http(s) schemes, on ports 80/443 unless the origin is allowlisted
 * - well-known local hostnames are refused outright
 * - the host is resolved once and *every* resolved address must be public;
 *   IPv6 forms that embed an IPv4 address (mapped, compatible, 6to4) are
 *   judged by the embedded address
 * - the socket connects only to the addresses that were checked, so a DNS
 *   answer that changes between check and connect cannot reach a private host
 * - optional origin allowlist via `PASCAL_ALLOWED_ASSET_ORIGINS` (comma-separated)
 *   - listed origins skip the port limit: an allowlisted origin may name any port
 *   - parsed by core's `allowedOriginsFrom`, the same reading as scene asset URLs
 * - max body size (default 20 MB) and request timeout (default 10 s)
 *
 * Used by photo_to_scene / analyze_floorplan_image / analyze_room_photo.
 */

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024 // 20 MB
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3
/** `URL.port` is '' when the URL uses its scheme's default port. */
const ALLOWED_PORTS = new Set(['', '80', '443'])

function parseIPv4(addr: string): number[] | null {
  const parts = addr.split('.')
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null
  const octets = parts.map(Number)
  return octets.every((n) => n <= 255) ? octets : null
}

/** Expands any valid IPv6 text form (incl. `::` and a dotted IPv4 tail) to 8 groups. */
function parseIPv6(addr: string): number[] | null {
  let s = addr.toLowerCase()
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  let tail: number[] = []
  const lastColon = s.lastIndexOf(':')
  if (lastColon < 0) return null
  if (s.slice(lastColon + 1).includes('.')) {
    const v4 = parseIPv4(s.slice(lastColon + 1))
    if (!v4) return null
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!]
    const prefix = s.slice(0, lastColon + 1)
    s = prefix.endsWith('::') ? prefix : prefix.slice(0, -1)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const groups = (part: string) =>
    part === ''
      ? []
      : part.split(':').map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN))
  const head = groups(halves[0]!)
  const rest = halves.length === 2 ? groups(halves[1]!) : []
  const explicit = head.length + rest.length + tail.length
  if ([...head, ...rest].some(Number.isNaN)) return null
  if (halves.length === 1) return explicit === 8 ? [...head, ...tail] : null
  if (explicit > 7) return null
  return [...head, ...new Array<number>(8 - explicit).fill(0), ...rest, ...tail]
}

/**
 * Ranges from the IANA IPv4 special-purpose registry that are not globally
 * reachable, plus multicast. Globally reachable entries (AS112, AMT) stay allowed.
 */
function isBlockedV4([a, b, c]: number[]): boolean {
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // 10.0.0.0/8 private
  if (a === 100 && b! >= 64 && b! <= 127) return true // 100.64.0.0/10 CGNAT (incl. Alibaba metadata)
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b! >= 16 && b! <= 31) return true // 172.16.0.0/12 private
  if (a === 192 && b === 0 && c === 0) return true // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true // 192.88.99.0/24 deprecated 6to4 relay anycast
  if (a === 192 && b === 168) return true // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // 203.0.113.0/24 TEST-NET-3
  if (a! >= 224) return true // multicast, reserved, broadcast
  return false
}

function embeddedV4(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]
}

function isBlockedV6(g: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const first4Zero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0
  // ::/96 (unspecified, loopback, IPv4-compatible), ::ffff:0:0/96 (mapped),
  // ::ffff:0:0:0/96 (translated) — judge by the embedded IPv4 address.
  if (first4Zero && ((g4 === 0 && (g5 === 0 || g5 === 0xffff)) || (g4 === 0xffff && g5 === 0))) {
    return isBlockedV4(embeddedV4(g6, g7))
  }
  if (g0 === 0x64 && g1 === 0xff9b) return true // 64:ff9b::/96 and 64:ff9b:1::/48 NAT64
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && (g3 === 0 || g3 === 1)) return true // 100::/64 discard, 100:0:0:1::/64 dummy
  // 2001::/23 IETF protocol assignments (incl. Teredo, benchmarking, ORCHID),
  // except the entries IANA lists as globally reachable.
  if (g0 === 0x2001 && g1 < 0x200) {
    const anycast = g1 === 1 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0
    if (anycast && g7 >= 1 && g7 <= 3) return false // 2001:1::1-3 PCP, TURN, DNS-SD SRP anycast
    if (g1 === 3) return false // 2001:3::/32 AMT
    if (g1 === 4 && g2 === 0x112) return false // 2001:4:112::/48 AS112-v6
    if (g1 >= 0x20 && g1 <= 0x3f) return false // 2001:20::/28 ORCHIDv2, 2001:30::/28 drone remote ID
    return true
  }
  if (g0 === 0x2001 && g1 === 0xdb8) return true // 2001:db8::/32 documentation
  if (g0 === 0x2002) return isBlockedV4(embeddedV4(g1, g2)) // 2002::/16 6to4
  if (g0 === 0x3fff && (g1 & 0xf000) === 0) return true // 3fff::/20 documentation
  if (g0 === 0x5f00) return true // 5f00::/16 SRv6 SIDs
  if ((g0 & 0xfe00) === 0xfc00) return true // fc00::/7 ULA (incl. fd00:ec2::254 metadata)
  if ((g0 & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true // fec0::/10 site-local
  if ((g0 & 0xff00) === 0xff00) return true // ff00::/8 multicast
  return false
}

/** True for any address a server-side fetch must not reach. Unparseable input is blocked. */
export function isBlockedAddress(address: string): boolean {
  const literal = address.replace(/^\[|\]$/g, '')
  const family = isIP(literal)
  if (family === 4) {
    const v4 = parseIPv4(literal)
    return v4 ? isBlockedV4(v4) : true
  }
  if (family === 6) {
    const v6 = parseIPv6(literal)
    return v6 ? isBlockedV6(v6) : true
  }
  return true
}

function isLocalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.+$/, '')
  return (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower === 'broadcasthost' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    lower.endsWith('.corp')
  )
}

const MAX_LOGGED_PATH = 128

/**
 * Scheme, host and a truncated path only: query strings can carry presigned
 * tokens, userinfo carries credentials. Non-http(s) URLs (`data:`,
 * `javascript:`) carry their payload in the path, so they log scheme and host.
 */
export function loggableUrl(url: URL): string {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return url.host ? `${url.protocol}//${url.host}` : url.protocol
  }
  const path =
    url.pathname.length > MAX_LOGGED_PATH
      ? `${url.pathname.slice(0, MAX_LOGGED_PATH)}…`
      : url.pathname
  return `${url.protocol}//${url.host}${path}`
}

function blocked(
  reason: string,
  url: URL,
  details: Record<string, unknown> = {},
  log: Record<string, unknown> = {},
): never {
  console.error(
    `[pascal-mcp] safe_fetch_blocked ${JSON.stringify({ reason, url: loggableUrl(url), ...details, ...log })}`,
  )
  return protocolError(reason, { url: loggableUrl(url), ...details })
}

function protocolError(reason: string, details: Record<string, unknown>): never {
  throw new ProtocolError(ProtocolErrorCode.InvalidParams, reason, details)
}

/** A system error's code (`ENOTFOUND`, `ECONNRESET`), never its message, which can quote the URL. */
function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'unknown'
}

function assertAllowedUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return protocolError('invalid_url', {})
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    blocked('url_scheme_not_allowed', parsed, { protocol: parsed.protocol })
  }
  // Node would send `user:pass@` as a Basic `Authorization` header.
  if (parsed.username || parsed.password) blocked('url_credentials_not_allowed', parsed)
  const allowlist = allowedOriginsFrom(process.env[ALLOWED_ORIGINS_ENV])
  if (allowlist) {
    if (!allowlist.has(parsed.origin)) {
      blocked('url_origin_not_allowlisted', parsed, { origin: parsed.origin })
    }
  } else if (!ALLOWED_PORTS.has(parsed.port)) {
    // An operator-allowlisted origin may name any port; otherwise only web ports,
    // so a public host cannot be used to probe its other services.
    blocked('url_port_not_allowed', parsed, { port: parsed.port })
  }
  return parsed
}

export type Resolver = (hostname: string) => Promise<LookupAddress[]>

/** Settles with `promise`, or rejects with the abort reason as soon as `signal` aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    const settle =
      <A>(done: (arg: A) => void) =>
      (arg: A) => {
        signal.removeEventListener('abort', onAbort)
        done(arg)
      }
    promise.then(settle(resolve), settle(reject))
  })
}

/**
 * Resolves `url`'s host and returns its addresses only if every one of them is
 * public. The lookup races `signal`: `dns.lookup` cannot be cancelled, so a
 * hung resolver must not hold the fetch past its timeout.
 */
async function resolveCheckedAddresses(
  url: URL,
  resolve: Resolver,
  signal: AbortSignal,
): Promise<LookupAddress[]> {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const details = { hostname: url.hostname }
  const literalFamily = isIP(host)
  let addresses: LookupAddress[]
  if (literalFamily) {
    addresses = [{ address: host, family: literalFamily }]
  } else {
    if (isLocalHostname(host)) blocked('url_host_blocked', url, details)
    try {
      addresses = await untilAborted(resolve(host), signal)
    } catch (err) {
      if (signal.aborted) throw err
      return protocolError('dns_lookup_failed', {
        url: loggableUrl(url),
        ...details,
        code: errorCode(err),
      })
    }
  }
  if (addresses.length === 0)
    protocolError('dns_lookup_failed', { url: loggableUrl(url), ...details, code: 'no_addresses' })
  const unsafe = addresses.find((a) => isBlockedAddress(a.address))
  if (unsafe) blocked('url_host_blocked', url, details, { address: unsafe.address })
  return addresses
}

/** A socket `lookup` that only ever answers with the given, already-checked addresses. */
export function pinnedLookup(addresses: LookupAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const family = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : options.family
    const matching =
      family === 4 || family === 6 ? addresses.filter((a) => a.family === family) : addresses
    const first = matching[0]
    if (!first) {
      callback(Object.assign(new Error('no checked address for family'), { code: 'ENOTFOUND' }), '')
    } else if (options.all) {
      callback(null, matching)
    } else {
      callback(null, first.address, first.family)
    }
  }
}

export type PinnedRequestInit = {
  headers: Record<string, string>
  lookup: LookupFunction
  signal: AbortSignal
}

export type Requester = (url: URL, init: PinnedRequestInit) => Promise<IncomingMessage>

function requestPinned(url: URL, init: PinnedRequestInit): Promise<IncomingMessage> {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method: 'GET',
        agent: false,
        headers: init.headers,
        lookup: init.lookup,
        signal: init.signal,
      },
      resolve,
    )
    req.on('error', reject)
    req.end()
  })
}

export type SafeFetchDeps = { resolve: Resolver; request: Requester }

const defaultDeps: SafeFetchDeps = {
  resolve: (hostname) => dnsLookup(hostname, { all: true, verbatim: true }),
  request: requestPinned,
}

export type SafeFetchOptions = {
  maxBytes?: number
  timeoutMs?: number
  /** Request `Accept` header to send. */
  accept?: string
}

export type SafeFetchResult = {
  buffer: Buffer
  contentType: string | null
  finalUrl: string
  hops: string[]
}

function header(res: IncomingMessage, name: string): string | null {
  const value = res.headers[name]
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

/**
 * SSRF-safe fetch that follows redirects manually, re-resolving and rechecking
 * the host on every hop and connecting only to the checked addresses. Throws
 * `ProtocolError` for blocked URLs, non-2xx responses, oversize bodies, or timeouts.
 */
export async function safeFetch(
  urlStr: string,
  opts: SafeFetchOptions = {},
  deps: SafeFetchDeps = defaultDeps,
): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const hops: string[] = []
  let current = urlStr
  let inFlight: URL | undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const parsed = assertAllowedUrl(current)
      inFlight = parsed
      hops.push(parsed.toString())
      const addresses = await resolveCheckedAddresses(parsed, deps.resolve, controller.signal)
      const res = await deps.request(parsed, {
        headers: opts.accept ? { Accept: opts.accept } : {},
        lookup: pinnedLookup(addresses),
        signal: controller.signal,
      })
      const status = res.statusCode ?? 0
      // Redirect and error bodies are never read: destroying the response
      // (no keep-alive, `agent: false`) bounds them at zero bytes.
      if (status >= 300 && status < 400) {
        res.destroy()
        const location = header(res, 'location')
        if (!location) {
          protocolError('redirect_without_location', { url: loggableUrl(parsed), status })
        }
        current = new URL(location, parsed).toString()
        continue
      }
      if (status < 200 || status >= 300) {
        res.destroy()
        protocolError('fetch_failed', {
          url: loggableUrl(parsed),
          status,
          // The standard text, never the server's reason phrase, which can echo the URL.
          statusText: STATUS_CODES[status] ?? '',
        })
      }
      const declared = Number(header(res, 'content-length') ?? Number.NaN)
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy()
        protocolError('response_too_large', { url: loggableUrl(parsed), declared, maxBytes })
      }
      // Running cap so servers that lie about length still get bounded.
      const chunks: Buffer[] = []
      let total = 0
      for await (const chunk of res) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        total += buf.byteLength
        if (total > maxBytes) {
          res.destroy()
          protocolError('response_too_large', {
            url: loggableUrl(parsed),
            received: total,
            maxBytes,
          })
        }
        chunks.push(buf)
      }
      return {
        buffer: Buffer.concat(chunks),
        contentType: header(res, 'content-type'),
        finalUrl: parsed.toString(),
        hops,
      }
    }
    return protocolError('too_many_redirects', {
      hops: hops.slice(0, MAX_REDIRECTS + 1).map((hop) => loggableUrl(new URL(hop))),
    })
  } catch (err) {
    if (err instanceof ProtocolError) throw err
    if (controller.signal.aborted || (err as { name?: string }).name === 'AbortError') {
      return protocolError('fetch_timeout', {
        ...(inFlight ? { url: loggableUrl(inFlight) } : {}),
        timeoutMs,
      })
    }
    return protocolError('fetch_error', {
      ...(inFlight ? { url: loggableUrl(inFlight) } : {}),
      code: errorCode(err),
    })
  } finally {
    clearTimeout(timer)
  }
}
