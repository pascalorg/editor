import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

const DEFAULT_RATE_LIMIT_PER_MINUTE = 120
const WINDOW_MS = 60_000
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
const ALLOWED_HEADERS = 'authorization, content-type, if-match, last-event-id, x-pascal-scene-token'

type RateBucket = {
  resetAt: number
  count: number
}

const rateBuckets = new Map<string, RateBucket>()

export function sceneApiPreflight(request: Request): NextResponse {
  const guard = guardSceneApiRequest(request, { skipRateLimit: true, skipAuth: true })
  if (guard) return guard
  return withSceneApiHeaders(request, new NextResponse(null, { status: 204 }))
}

export function guardSceneApiRequest(
  request: Request,
  opts: { skipRateLimit?: boolean; skipAuth?: boolean } = {},
): NextResponse | null {
  const originError = validateOrigin(request)
  if (originError) return originError

  if (!opts.skipAuth) {
    const authError = validateAuth(request)
    if (authError) return authError
  }

  if (!opts.skipRateLimit) {
    const rateError = validateRateLimit(request)
    if (rateError) return rateError
  }

  return null
}

export function sceneApiJson(request: Request, body: unknown, init?: ResponseInit): NextResponse {
  return withSceneApiHeaders(request, NextResponse.json(body, init))
}

export function withSceneApiHeaders<T extends Response>(request: Request, response: T): T {
  const origin = request.headers.get('origin')
  if (origin && isOriginAllowed(request, origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.append('Vary', 'Origin')
  }
  response.headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS)
  response.headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS)
  response.headers.set('Cache-Control', response.headers.get('Cache-Control') ?? 'no-store')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}

function validateOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get('origin')
  if (!origin || isOriginAllowed(request, origin)) return null
  return sceneApiJson(request, { error: 'origin_not_allowed' }, { status: 403 })
}

function validateAuth(request: Request): NextResponse | null {
  const token = process.env.PASCAL_SCENE_API_TOKEN
  if (!token) {
    if (isLoopbackRequest(request)) return null
    return sceneApiJson(request, { error: 'scene_api_token_required' }, { status: 503 })
  }

  const supplied = bearerToken(request) ?? request.headers.get('x-pascal-scene-token')
  if (supplied && safeEqual(supplied, token)) return null
  return sceneApiJson(request, { error: 'unauthorized' }, { status: 401 })
}

function validateRateLimit(request: Request): NextResponse | null {
  const limit = rateLimitPerMinute()
  if (limit <= 0) return null

  const now = Date.now()
  const key = clientIp(request)
  const bucket = rateBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return null
  }

  bucket.count++
  if (bucket.count <= limit) return null

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  const response = sceneApiJson(request, { error: 'rate_limited' }, { status: 429 })
  response.headers.set('Retry-After', String(retryAfter))
  return response
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  if (aBuffer.length !== bBuffer.length) return false
  return timingSafeEqual(aBuffer, bBuffer)
}

function rateLimitPerMinute(): number {
  const raw = process.env.PASCAL_SCENE_API_RATE_LIMIT
  if (!raw) return DEFAULT_RATE_LIMIT_PER_MINUTE
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : DEFAULT_RATE_LIMIT_PER_MINUTE
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  return request.headers.get('x-real-ip') ?? 'unknown'
}

function isOriginAllowed(request: Request, origin: string): boolean {
  if (isSameOrigin(request, origin)) return true
  const parsed = parseUrl(origin)
  if (!parsed) return false
  if (isLoopbackHostname(parsed.hostname)) return true
  return configuredOrigins().has(normalizeOrigin(parsed))
}

function configuredOrigins(): Set<string> {
  const raw = process.env.PASCAL_SCENE_API_ORIGINS
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map((part) => parseUrl(part.trim()))
      .filter((url): url is URL => url !== null)
      .map(normalizeOrigin),
  )
}

function isSameOrigin(request: Request, origin: string): boolean {
  const parsedOrigin = parseUrl(origin)
  if (!parsedOrigin) return false
  const requestUrl = new URL(request.url)
  return normalizeOrigin(parsedOrigin) === normalizeOrigin(requestUrl)
}

function isLoopbackRequest(request: Request): boolean {
  const host = request.headers.get('host') ?? new URL(request.url).host
  return isLoopbackHostname(stripPort(host))
}

function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1'
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function normalizeOrigin(url: URL): string {
  return `${url.protocol}//${url.host}`.toLowerCase()
}

function stripPort(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? host : host.slice(1, end)
  }
  return host.split(':')[0] ?? host
}
