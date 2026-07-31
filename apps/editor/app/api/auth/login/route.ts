import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { authAvailable } from '@/lib/auth/db'
import { createSession, InvalidCredentialsError, loginUser } from '@/lib/auth/service'
import { setSessionCookie } from '@/lib/auth/session'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'

const schema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
})

const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 10
const attempts = new Map<string, { count: number; resetAt: number }>()

function throttle(request: NextRequest): boolean {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  const now = Date.now()
  const bucket = attempts.get(ip)
  if (!bucket || bucket.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  bucket.count++
  return bucket.count > MAX_ATTEMPTS
}

export async function POST(request: NextRequest) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard
  if (!authAvailable()) {
    return sceneApiJson(request, { error: 'auth_unavailable' }, { status: 503 })
  }
  if (throttle(request)) {
    return sceneApiJson(request, { error: 'rate_limited' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  }

  try {
    const user = await loginUser(parsed.data)
    const token = await createSession(user.id)
    await setSessionCookie(token)
    return sceneApiJson(request, { user }, { status: 200 })
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      return sceneApiJson(request, { error: 'invalid_credentials' }, { status: 401 })
    }
    const message = err instanceof Error ? err.message : 'unexpected_error'
    return sceneApiJson(request, { error: 'internal_error', message }, { status: 500 })
  }
}
