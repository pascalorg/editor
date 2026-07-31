import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { authAvailable } from '@/lib/auth/db'
import { createSession, EmailTakenError, registerUser } from '@/lib/auth/service'
import { setSessionCookie } from '@/lib/auth/session'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'

const schema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
})

export async function POST(request: NextRequest) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard
  if (!authAvailable()) {
    return sceneApiJson(request, { error: 'auth_unavailable' }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  try {
    const user = await registerUser(parsed.data)
    const token = await createSession(user.id)
    await setSessionCookie(token)
    return sceneApiJson(request, { user }, { status: 201 })
  } catch (err) {
    if (err instanceof EmailTakenError) {
      return sceneApiJson(request, { error: 'email_taken' }, { status: 409 })
    }
    const message = err instanceof Error ? err.message : 'unexpected_error'
    return sceneApiJson(request, { error: 'internal_error', message }, { status: 500 })
  }
}
