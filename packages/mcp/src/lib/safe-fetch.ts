import { isIPv4, isIPv6 } from 'node:net'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'

/**
 * SSRF-safe fetch for user-supplied URLs (image URLs in vision tools).
 *
 * Blocks the usual server-side-request-forgery attack surface:
 * - loopback (127.0.0.0/8, ::1)
 * - link-local (169.254.0.0/16 — includes cloud metadata at 169.254.169.254)
 * - private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7)
 * - non-http(s) schemes
 * - manual-redirect with the same allowlist applied to each hop
 * - max body size (default 20 MB)
 * - request timeout (default 10 s)
 *
 * Optional allowlist via `PASCAL_ALLOWED_ASSET_ORIGINS` env var (comma-separated).
 *
 * Phase 10 A2 found that photo_to_scene / analyze_floorplan_image /
 * analyze_room_photo all called raw `fetch(url)` with no protection, giving
 * a direct `169.254.169.254` exfil primitive on any host.
 */

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024 // 20 MB
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3

function isPrivateOrLoopbackV4(addr: string): boolean {
  const parts = addr.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true // malformed → treat as unsafe
  const [a, b] = parts as [number, number, number, number]
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 10) return true // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true // link-local incl. cloud metadata
  if (a === 0) return true // current-network
  if (a >= 224) return true // multicast / reserved
  return false
}

function isPrivateOrLoopbackV6(addr: string): boolean {
  const lower = addr.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (
    lower.startsWith('fe80:') ||
    lower.startsWith('fe90:') ||
    lower.startsWith('fea0:') ||
    lower.startsWith('feb0:')
  )
    return true // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // ULA fc00::/7
  if (lower.startsWith('::ffff:')) {
    // v4-mapped
    const v4 = lower.slice(7)
    if (isIPv4(v4)) return isPrivateOrLoopbackV4(v4)
  }
  return false
}

function isUnsafeHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '') // strip IPv6 brackets if any
  if (isIPv4(host)) return isPrivateOrLoopbackV4(host)
  if (isIPv6(host)) return isPrivateOrLoopbackV6(host)
  // Hostname (not IP) — block well-known local names.
  const lower = host.toLowerCase()
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower === 'broadcasthost' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    lower.endsWith('.corp')
  ) {
    return true
  }
  return false
}

function assertAllowedUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new McpError(ErrorCode.InvalidParams, 'invalid_url', { url })
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new McpError(ErrorCode.InvalidParams, 'url_scheme_not_allowed', {
      url,
      protocol: parsed.protocol,
    })
  }
  if (isUnsafeHost(parsed.hostname)) {
    throw new McpError(ErrorCode.InvalidParams, 'url_host_blocked', {
      url,
      hostname: parsed.hostname,
    })
  }
  // Optional env-allowlist narrowing.
  const allowEnv = process.env.PASCAL_ALLOWED_ASSET_ORIGINS
  if (allowEnv) {
    const origins = allowEnv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!origins.includes(parsed.origin)) {
      throw new McpError(ErrorCode.InvalidParams, 'url_origin_not_allowlisted', {
        url,
        origin: parsed.origin,
      })
    }
  }
  return parsed
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

/**
 * SSRF-safe fetch that follows redirects manually, revalidating the host
 * allowlist + private-IP check on every hop. Throws `McpError` for blocked
 * URLs, non-2xx responses, oversize bodies, or timeouts.
 */
export async function safeFetch(
  urlStr: string,
  opts: SafeFetchOptions = {},
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
      const res = await fetch(parsed, {
        redirect: 'manual',
        signal: controller.signal,
        headers: opts.accept ? { Accept: opts.accept } : undefined,
      })
      // Manual redirect handling
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) {
          throw new McpError(ErrorCode.InvalidParams, 'redirect_without_location', {
            url: parsed.toString(),
            status: res.status,
          })
        }
        current = new URL(location, parsed).toString()
        continue
      }
      if (!res.ok) {
        throw new McpError(ErrorCode.InvalidParams, 'fetch_failed', {
          url: parsed.toString(),
          status: res.status,
          statusText: res.statusText,
        })
      }
      // Enforce Content-Length up front if present.
      const declared = Number(res.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new McpError(ErrorCode.InvalidParams, 'response_too_large', {
          url: parsed.toString(),
          declared,
          maxBytes,
        })
      }
      // Stream with a running cap so servers that lie about length still get bounded.
      const reader = res.body?.getReader()
      if (!reader) {
        throw new McpError(ErrorCode.InvalidParams, 'empty_response', {
          url: parsed.toString(),
        })
      }
      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          total += value.byteLength
          if (total > maxBytes) {
            try {
              await reader.cancel()
            } catch {
              // ignore
            }
            throw new McpError(ErrorCode.InvalidParams, 'response_too_large', {
              url: parsed.toString(),
              received: total,
              maxBytes,
            })
          }
          chunks.push(value)
        }
      }
      return {
        buffer: Buffer.concat(chunks.map((c) => Buffer.from(c))),
        contentType: res.headers.get('content-type'),
        finalUrl: parsed.toString(),
        hops,
      }
    }
    throw new McpError(ErrorCode.InvalidParams, 'too_many_redirects', {
      hops: hops.slice(0, MAX_REDIRECTS + 1),
    })
  } catch (err) {
    if (err instanceof McpError) throw err
    if ((err as { name?: string }).name === 'AbortError') {
      throw new McpError(ErrorCode.InvalidParams, 'fetch_timeout', { url: urlStr, timeoutMs })
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new McpError(ErrorCode.InvalidParams, 'fetch_error', { url: urlStr, message })
  } finally {
    clearTimeout(timer)
  }
}
