import { z } from 'zod'

/**
 * Scheme allowlist for asset-like URLs embedded in scene graphs.
 *
 * Phase 3 security audit: `scan.url`, `guide.url`, `material.texture.url`, and
 * `item.asset.src` were previously bare `z.string()`. That meant an
 * attacker-crafted scene loaded in the editor could beacon to arbitrary URLs
 * (e.g. `javascript:`, `file:///etc/passwd`, `http://169.254.169.254/...`).
 *
 * This validator rejects URLs that don't match the scheme allowlist below.
 */
const ALLOWED_SCHEMES = ['artifact:', 'asset:', 'blob:', 'https:', 'data:image/'] as const

/**
 * Optional environment variable that narrows which `https:` origins are
 * accepted, here and by the MCP server's `safeFetch`. Set to a comma-separated
 * list (e.g. `https://cdn.pascal.app`). When unset or empty, any `https:`
 * origin is permitted; when set, only listed origins are, and a value with no
 * valid entry (whitespace only, every entry malformed) permits no `https:` origin.
 */
export const ALLOWED_ORIGINS_ENV = 'PASCAL_ALLOWED_ASSET_ORIGINS'

export type AllowedOriginIssue = {
  /** Position of the entry in the comma-separated list, from 0. */
  index: number
  /**
   * `credentials_dropped`: the entry is kept for its origin, its userinfo is not.
   * Every other reason means the entry was skipped.
   */
  reason: 'not_a_url' | 'scheme_not_allowed' | 'wildcard_not_supported' | 'credentials_dropped'
}

/**
 * Parses an origin allowlist into normalised origins (`new URL(entry).origin`),
 * so `https://CDN.example.com:443/` and `https://cdn.example.com` are the same
 * entry. Only `http:` and `https:` entries count: other schemes either have no
 * origin or, like `blob:https://…`, borrow one they were not meant to grant.
 * Wildcard hosts (`https://*.example.com`) are not patterns, so they are
 * rejected rather than kept as an origin that never matches. Issues are
 * reported by position and reason only, never by value, since an entry may
 * carry credentials (`https://user:secret@host`).
 */
export function parseAllowedOrigins(raw: string): {
  origins: Set<string>
  issues: AllowedOriginIssue[]
} {
  const origins = new Set<string>()
  const issues: AllowedOriginIssue[] = []
  raw.split(',').forEach((entry, index) => {
    const trimmed = entry.trim()
    if (!trimmed) return
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      issues.push({ index, reason: 'not_a_url' })
      return
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      issues.push({ index, reason: 'scheme_not_allowed' })
      return
    }
    if (parsed.hostname.includes('*')) {
      issues.push({ index, reason: 'wildcard_not_supported' })
      return
    }
    if (parsed.username || parsed.password) issues.push({ index, reason: 'credentials_dropped' })
    origins.add(parsed.origin)
  })
  return { origins, issues }
}

let allowlistCache: { raw: string; origins: ReadonlySet<string> } | null = null

/** Test-only: forget the cached allowlist so its warnings are logged again. */
export function __resetAllowedOriginsCacheForTests(): void {
  allowlistCache = null
}

/**
 * The allowlist set in `raw` (the value of {@link ALLOWED_ORIGINS_ENV}), or
 * `undefined` when it is unset or empty. Only the most recent value is cached,
 * so its warnings (skipped entries, dropped credentials, no valid entry, no
 * https: entry) are logged when a value is first read and again whenever the
 * value changes.
 */
export function allowedOriginsFrom(raw: string | undefined): ReadonlySet<string> | undefined {
  if (!raw) return undefined
  if (allowlistCache?.raw === raw) return allowlistCache.origins
  const { origins, issues } = parseAllowedOrigins(raw)
  for (const issue of issues) {
    if (issue.reason === 'credentials_dropped') {
      console.warn(
        `[pascal] asset_allowlist_entry_credentials_dropped ${JSON.stringify({ index: issue.index })}`,
      )
    } else {
      console.warn(`[pascal] asset_allowlist_entry_ignored ${JSON.stringify(issue)}`)
    }
  }
  if (origins.size === 0) {
    console.warn('[pascal] asset_allowlist_has_no_valid_entries: no origin is permitted')
  } else if (![...origins].some((origin) => origin.startsWith('https://'))) {
    console.warn(
      '[pascal] asset_allowlist_has_no_https_entries: scene asset URLs accept only https: origins, so every one is rejected (safeFetch still fetches the listed http: origins)',
    )
  }
  allowlistCache = { raw, origins }
  return origins
}

// Narrow access to the environment variable without requiring @types/node in
// this package. The core package ships to both browser and Node contexts.
function readAllowedOrigins(): ReadonlySet<string> | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } }
  return allowedOriginsFrom(g.process?.env?.[ALLOWED_ORIGINS_ENV])
}

function isAllowedAssetUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false
  if (url.startsWith('asset://')) return true // internal handle
  if (/^artifact:\/\/[0-9a-f]{64}$/.test(url)) return true // content-addressed artifact
  if (url.startsWith('blob:')) return true // in-memory reference
  if (url.startsWith('data:image/')) return true // inline image only (never data:text/html)
  if (url.startsWith('/')) return true // app-relative path
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    // http is only permitted for localhost development
    if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
      return false
    }
    // optional env-driven origin allowlist (only enforced for https URLs)
    if (parsed.protocol === 'https:') {
      const allowlist = readAllowedOrigins()
      if (allowlist) return allowlist.has(parsed.origin)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Zod validator for asset-style URL fields. Accepts:
 * - `asset://…` internal handles
 * - `artifact://<sha256>` content-addressed artifacts (see lib/artifact-store)
 * - `blob:…` in-memory references
 * - `data:image/…` inline images (not `data:text/html` or other types)
 * - `/…` app-relative paths
 * - `https://…` public URLs (optionally narrowed to an env allowlist)
 * - `http://localhost[:port]/…` or `http://127.0.0.1/…` for local dev
 *
 * Rejects every other scheme, including `javascript:`, `file:`, `ftp:`,
 * and `data:text/html`, as well as empty strings and non-URL garbage.
 */
export const AssetUrl = z.string().refine(isAllowedAssetUrl, {
  message:
    'URL must be artifact://, asset://, blob:, data:image/, /path, or https://. http://localhost allowed for dev.',
})

export type AssetUrl = z.infer<typeof AssetUrl>

// re-export the scheme allowlist for documentation / downstream validators
export { ALLOWED_SCHEMES }
