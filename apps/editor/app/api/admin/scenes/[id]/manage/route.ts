import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/admin'
import { unpublishScene } from '@/lib/auth/site-scenes'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('rename'), name: z.string().trim().min(1).max(200) }),
  z.object({ action: z.literal('duplicate') }),
  z.object({ action: z.literal('delete') }),
])

/**
 * POST /api/admin/scenes/[id]/manage — rename, duplicate or delete a project
 * from the console.
 *
 * Duplicating copies the graph into a new scene owned by the same person and
 * marked as a copy; the copy is a draft, because publishing is an approval
 * and approval does not transfer. Deleting removes the scene and withdraws
 * its site card first, so no card is left pointing at nothing.
 */
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
  if (!parsed.success) return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })

  const operations = await getSceneOperations()
  const scene = await operations.loadStoredScene(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  if (parsed.data.action === 'rename') {
    const meta = await operations.renameStoredScene(id, parsed.data.name)
    return sceneApiJson(request, { ok: true, name: meta.name })
  }

  if (parsed.data.action === 'duplicate') {
    const copy = await operations.saveScene({
      name: `${scene.name} (copy)`.slice(0, 200),
      projectId: scene.projectId ?? null,
      ownerId: scene.ownerId ?? undefined,
      graph: scene.graph as never,
      thumbnailUrl: scene.thumbnailUrl ?? null,
    })
    return sceneApiJson(request, { ok: true, id: copy.id }, { status: 201 })
  }

  // Withdraw first: a site card outliving its scene is a dead link on the
  // one screen the whole organisation reads.
  await unpublishScene(id)
  const deleted = await operations.deleteStoredScene(id)
  return sceneApiJson(request, { ok: deleted })
}
