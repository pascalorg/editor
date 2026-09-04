import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { adoptUnownedScenes, requireAdmin, userExists } from '@/lib/auth/admin'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'

const schema = z.object({ ownerId: z.string().min(1).max(64) })

/** Adopts every legacy null-owner scene to one user. */
export async function POST(request: NextRequest) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard
  const admin = await requireAdmin()
  if (!admin) return sceneApiJson(request, { error: 'forbidden' }, { status: 403 })

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
  if (!(await userExists(parsed.data.ownerId))) {
    return sceneApiJson(request, { error: 'owner_not_found' }, { status: 400 })
  }

  const adopted = await adoptUnownedScenes(parsed.data.ownerId)
  return sceneApiJson(request, { ok: true, adopted })
}
