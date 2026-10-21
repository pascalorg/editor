import type { LookupAddress } from 'node:dns'
import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'

/**
 * SSRF-safe fetch for user-supplied URLs (image URLs in vision tools).
 *
 * Every hop (the initial URL and each redirect target) is checked the same way:
 * - only http(s) schemes
 * - well-known local hostnames are refused outright
 * - the host is resolved once and *every* resolved address must be public;
 *   IPv6 forms that embed an IPv4 address (mapped, compatible, 6to4) are
 *   judged by the embedded address
 * - the socket connects only to the addresses that were checked, so a DNS
 *   answer that changes between check and connect cannot reach a private host
 * - optional origin allowlist via `PASCAL_ALLOWED_ASSET_ORIGINS` (comma-separated)
 * - max body size (default 20 MB) and request timeout (default 10 s)
 *
 * Used by photo_to_scene / analyze_floorplan_image / analyze_room_photo.
 */

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024 // 20 MB
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3

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

function isBlockedV4([a, b]: number[]): boolean {
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // 10.0.0.0/8 private
  if (a === 100 && b! >= 64 && b! <= 127) return true // 100.64.0.0/10 CGNAT (incl. Alibaba metadata)
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b! >= 16 && b! <= 31) return true // 172.16.0.0/12 private
  if (a === 192 && b === 0) return true // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 168) return true // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmarking
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
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true // 100::/64 discard
  if (g0 === 0x2001 && g1 === 0) return true // 2001::/32 Teredo
  if (g0 === 0x2002) return isBlockedV4(embeddedV4(g1, g2)) // 2002::/16 6to4
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

function blocked(
  reason: string,
  details: Record<string, unknown>,
  log: Record<string, unknown> = {},
): never {
  console.error(`[pascal-mcp] safe_fetch_blocked ${JSON.stringify({ reason, ...details, ...log })}`)
  return protocolError(reason, details)
}

function protocolError(reason: string, details: Record<string, unknown>): never {
  throw new ProtocolError(ProtocolErrorCode.InvalidParams, reason, details)
}

function assertAllowedUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return protocolError('invalid_url', { url })
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    blocked('url_scheme_not_allowed', { url, protocol: parsed.protocol })
  }
  const allowEnv = process.env.PASCAL_ALLOWED_ASSET_ORIGINS
  if (allowEnv) {
    const origins = allowEnv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!origins.includes(parsed.origin)) {
      blocked('url_origin_not_allowlisted', { url, origin: parsed.origin })
    }
  }
  return parsed
}

export type Resolver = (hostname: string) => Promise<LookupAddress[]>

/** Resolves `url`'s host and returns its addresses only if every one of them is public. */
async function resolveCheckedAddresses(url: URL, resolve: Resolver): Promise<LookupAddress[]> {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const details = { url: url.toString(), hostname: url.hostname }
  const literalFamily = isIP(host)
  let addresses: LookupAddress[]
  if (literalFamily) {
    addresses = [{ address: host, family: literalFamily }]
  } else {
    if (isLocalHostname(host)) blocked('url_host_blocked', details)
    try {
      addresses = await resolve(host)
    } catch (err) {
      return protocolError('dns_lookup_failed', {
        ...details,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (addresses.length === 0) protocolError('dns_lookup_failed', details)
  const unsafe = addresses.find((a) => isBlockedAddress(a.address))
  if (unsafe) blocked('url_host_blocked', details, { address: unsafe.address })
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
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const parsed = assertAllowedUrl(current)
      hops.push(parsed.toString())
      const addresses = await resolveCheckedAddresses(parsed, deps.resolve)
      const res = await deps.request(parsed, {
        headers: opts.accept ? { Accept: opts.accept } : {},
        lookup: pinnedLookup(addresses),
        signal: controller.signal,
      })
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400) {
        res.resume()
        const location = header(res, 'location')
        if (!location) {
          protocolError('redirect_without_location', { url: parsed.toString(), status })
        }
        current = new URL(location, parsed).toString()
        continue
      }
      if (status < 200 || status >= 300) {
        res.resume()
        protocolError('fetch_failed', {
          url: parsed.toString(),
          status,
          statusText: res.statusMessage ?? '',
        })
      }
      const declared = Number(header(res, 'content-length') ?? Number.NaN)
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy()
        protocolError('response_too_large', { url: parsed.toString(), declared, maxBytes })
      }
      // Running cap so servers that lie about length still get bounded.
      const chunks: Buffer[] = []
      let total = 0
      for await (const chunk of res) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        total += buf.byteLength
        if (total > maxBytes) {
          res.destroy()
          protocolError('response_too_large', { url: parsed.toString(), received: total, maxBytes })
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
    return protocolError('too_many_redirects', { hops: hops.slice(0, MAX_REDIRECTS + 1) })
  } catch (err) {
    if (err instanceof ProtocolError) throw err
    if (controller.signal.aborted || (err as { name?: string }).name === 'AbortError') {
      return protocolError('fetch_timeout', { url: urlStr, timeoutMs })
    }
    return protocolError('fetch_error', {
      url: urlStr,
      message: err instanceof Error ? err.message : String(err),
    })
  } finally {
    clearTimeout(timer)
  }
}
