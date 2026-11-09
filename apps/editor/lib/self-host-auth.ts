import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Single-admin authentication for a self-hosted editor.
 *
 * One workspace behind one password: `PASCAL_ADMIN_PASSWORD` unlocks the whole
 * instance, the session principal is always `admin`. Sessions are HMAC tokens
 * keyed by a digest of the password, so there is no second secret to configure
 * and changing the password signs everyone out.
 */
export const SESSION_COOKIE = 'pascal_session'
export const ADMIN_PRINCIPAL = 'admin'
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
const LOGIN_ATTEMPTS_PER_MINUTE = 10
const LOGIN_WINDOW_MS = 60_000

/**
 * - `password`: `PASCAL_ADMIN_PASSWORD` is set; every page and API needs a session or a bearer.
 * - `open`: no password, but the host is loopback (dev server, the CLI's managed editor) or
 *   `PASCAL_AUTH=proxy` says an upstream proxy authenticates.
 * - `unconfigured`: reachable from the network with nothing set; the app refuses to serve.
 */
export type AuthMode = 'password' | 'open' | 'unconfigured'

export function resolveAuthMode(request: Request, env: NodeJS.ProcessEnv = process.env): AuthMode {
  if (env.PASCAL_ADMIN_PASSWORD) return 'password'
  if (env.PASCAL_AUTH === 'proxy') return 'open'
  if (isLoopbackRequest(request)) return 'open'
  return 'unconfigured'
}

export function verifyPassword(supplied: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const configured = env.PASCAL_ADMIN_PASSWORD
  if (!configured) return false
  return safeEqual(supplied, configured)
}

export function issueSession(env: NodeJS.ProcessEnv = process.env, now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000)
  return `1.${issuedAt}.${sign(issuedAt, env)}`
}

export function verifySession(
  value: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): boolean {
  if (!value || !env.PASCAL_ADMIN_PASSWORD) return false
  const [version, issuedAtRaw, signature] = value.split('.')
  if (version !== '1' || !issuedAtRaw || !signature) return false
  const issuedAt = Number.parseInt(issuedAtRaw, 10)
  if (!Number.isFinite(issuedAt)) return false
  const ageSeconds = Math.floor(now / 1000) - issuedAt
  if (ageSeconds < 0 || ageSeconds > SESSION_TTL_SECONDS) return false
  return safeEqual(signature, sign(issuedAt, env))
}

/** The signed-in principal, or null when the request carries no valid session. */
export function sessionPrincipal(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): typeof ADMIN_PRINCIPAL | null {
  return verifySession(readCookie(request, SESSION_COOKIE), env, now) ? ADMIN_PRINCIPAL : null
}

export function sessionCookie(request: Request, value: string, maxAge: number): string {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
  if (isSecureRequest(request)) parts.push('Secure')
  return parts.join('; ')
}

const loginBuckets = new Map<string, { resetAt: number; count: number }>()

/** True when this client may attempt a login now; attempts are counted per IP. */
export function allowLoginAttempt(request: Request, now = Date.now()): boolean {
  const key =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  const bucket = loginBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    loginBuckets.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
    return true
  }
  bucket.count++
  return bucket.count <= LOGIN_ATTEMPTS_PER_MINUTE
}

export function isLoopbackRequest(request: Request): boolean {
  const host = request.headers.get('host') ?? new URL(request.url).host
  return isLoopbackHostname(stripPort(host))
}

export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1'
}

function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')
  if (forwarded) return forwarded.split(',')[0]?.trim() === 'https'
  return new URL(request.url).protocol === 'https:'
}

function sign(issuedAt: number, env: NodeJS.ProcessEnv): string {
  const key = createHash('sha256')
    .update(env.PASCAL_ADMIN_PASSWORD ?? '')
    .digest()
  return createHmac('sha256', key).update(`${ADMIN_PRINCIPAL}:${issuedAt}`).digest('base64url')
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return undefined
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  if (aBuffer.length !== bBuffer.length) return false
  return timingSafeEqual(aBuffer, bBuffer)
}

function stripPort(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? host : host.slice(1, end)
  }
  return host.split(':')[0] ?? host
}
