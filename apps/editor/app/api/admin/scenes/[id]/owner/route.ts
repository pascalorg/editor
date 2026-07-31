import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { reassignScene, requireAdmin, userExists } from '@/lib/auth/admin'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

const schema = z.object({ ownerId: z.string().min(1).max(64).nullable() })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard
  const admin = await requireAdmin()
  if (!admin) return sceneApiJson(request, { error: 'forbidden' }, { status: 403 })

  const { id } = await params
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

  const operations = await getSceneOperations()
  const scene = await operations.loadStoredScene(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  if (parsed.data.ownerId && !(await userExists(parsed.data.ownerId))) {
    return sceneApiJson(request, { error: 'owner_not_found' }, { status: 400 })
  }

  await reassignScene(id, parsed.data.ownerId)
  return sceneApiJson(request, { ok: true })
}
