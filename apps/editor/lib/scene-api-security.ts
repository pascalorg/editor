import { getDatabase } from '@pascal-app/db'
import { projectMembers, projects, scenes } from '@pascal-app/db/schema'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getAuth } from './auth'
import { checkRateLimit } from './rate-limit'

const DEFAULT_RATE_LIMIT_PER_MINUTE = 120
const RATE_LIMIT_WINDOW_MS = 60_000
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
const ALLOWED_HEADERS = 'authorization, content-type, if-match, last-event-id'

import { apiTokens } from '@pascal-app/db/schema'

export type Actor =
  | { type: 'user'; userId: string; isAnonymous: boolean; scopes?: string[] }
  | { type: 'anon' }

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function resolveActor(requestOrHeaders: Request | Headers): Promise<Actor> {
  const headers = requestOrHeaders instanceof Headers ? requestOrHeaders : requestOrHeaders.headers

  // 1. Check for PAT
  const authHeader = headers.get('authorization')
  if (authHeader?.startsWith('Bearer pascal_pat_')) {
    const token = authHeader.substring(7) // remove 'Bearer '
    try {
      const db = getDatabase()
      const hash = await hashToken(token)
      const rows = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hash)).limit(1)
      const row = rows[0]

      if (row) {
        const now = new Date()
        if (row.revokedAt && row.revokedAt <= now) return { type: 'anon' }
        if (row.expiresAt && row.expiresAt <= now) return { type: 'anon' }

        // Throttle lastUsedAt updates to 1 minute
        if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60000) {
          // Fire and forget update
          db.update(apiTokens)
            .set({ lastUsedAt: now })
            .where(eq(apiTokens.id, row.id))
            .execute()
            .catch(() => {})
        }

        return { type: 'user', userId: row.userId, isAnonymous: false, scopes: row.scopes || [] }
      }
    } catch {
      // DB error or hash error, fallback to anon or session
    }
  }

  // 2. Fallback to session
  const session = await getAuth().api.getSession({ headers })
  if (session?.user?.id) {
    return {
      type: 'user',
      userId: session.user.id,
      isAnonymous: (session.user as any).isAnonymous ?? false,
    }
  }
  return { type: 'anon' }
}

export async function authorizeScene(
  actor: Actor,
  sceneId: string,
  action: 'read' | 'write' | 'delete',
): Promise<boolean> {
  // If PAT, check scopes
  if (actor.type === 'user' && actor.scopes && !actor.scopes.includes(`scenes:${action}`)) {
    return false
  }

  let db
  try {
    db = getDatabase()
  } catch (e) {
    // If running in an environment without Postgres, assume no access
    return false
  }

  const sceneRows = await db.select().from(scenes).where(eq(scenes.id, sceneId)).limit(1)
  const scene = sceneRows[0]
  if (!scene) return false

  // Project scene
  if (scene.projectId) {
    const projectRows = await db
      .select()
      .from(projects)
      .where(eq(projects.id, scene.projectId))
      .limit(1)
    const project = projectRows[0]
    if (!project) return false

    if (
      action === 'read' &&
      (project.visibility === 'public' || project.visibility === 'unlisted')
    ) {
      return true
    }

    if (actor.type === 'user') {
      if (project.ownerId === actor.userId) return true
      const memberRows = await db
        .select()
        .from(projectMembers)
        .where(
          and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, actor.userId)),
        )
        .limit(1)
      const member = memberRows[0]
      if (member) {
        if (member.role === 'owner' || member.role === 'editor') return true
        if (member.role === 'viewer' && action === 'read') return true
      }
    }
    return false
  }

  // Personal scene
  if (scene.ownerId) {
    if (actor.type === 'user' && scene.ownerId === actor.userId) {
      return true
    }
    return false
  }

  // Ownerless scene (anonymous fallback)
  return true
}

export async function authorizeProject(
  actor: Actor,
  projectId: string,
  action: 'read' | 'write',
): Promise<boolean> {
  // If PAT, check scopes (for projects, we check the scene equivalent scope since PATs only declare scene scopes)
  if (actor.type === 'user' && actor.scopes && !actor.scopes.includes(`scenes:${action}`)) {
    return false
  }

  let db
  try {
    db = getDatabase()
  } catch (e) {
    return false
  }

  const projectRows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  const project = projectRows[0]
  if (!project) return false

  if (action === 'read' && (project.visibility === 'public' || project.visibility === 'unlisted')) {
    return true
  }

  if (actor.type === 'user') {
    if (project.ownerId === actor.userId) return true
    const memberRows = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, actor.userId)))
      .limit(1)
    const member = memberRows[0]
    if (member) {
      if (member.role === 'owner' || member.role === 'editor') return true
      if (member.role === 'viewer' && action === 'read') return true
    }
  }

  return false
}

export async function sceneApiPreflight(request: Request): Promise<NextResponse> {
  const guard = await guardSceneApiRequest(request, { skipRateLimit: true, skipAuth: true })
  if (guard) return guard
  return withSceneApiHeaders(request, new NextResponse(null, { status: 204 }))
}

export async function guardSceneApiRequest(
  request: Request,
  opts: { skipRateLimit?: boolean; skipAuth?: boolean } = {},
): Promise<NextResponse | null> {
  const originError = validateOrigin(request)
  if (originError) return originError

  if (!opts.skipRateLimit) {
    const rateError = await validateRateLimit(request)
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

async function validateRateLimit(request: Request): Promise<NextResponse | null> {
  const limit = rateLimitPerMinute()
  if (limit <= 0) return null

  // User-based keying, IP only as the anonymous fallback — a NAT's fifty
  // users must not throttle each other off one shared IP.
  const actor = await resolveActor(request)
  const key = actor.type === 'user' ? `user:${actor.userId}` : `ip:${clientIp(request)}`

  const result = await checkRateLimit(key, limit, RATE_LIMIT_WINDOW_MS)
  if (!result || result.allowed) return null

  const response = sceneApiJson(request, { error: 'rate_limited' }, { status: 429 })
  response.headers.set('Retry-After', String(result.retryAfter))
  response.headers.set('X-RateLimit-Limit', String(result.limit))
  response.headers.set('X-RateLimit-Remaining', String(result.remaining))
  response.headers.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)))
  return response
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
