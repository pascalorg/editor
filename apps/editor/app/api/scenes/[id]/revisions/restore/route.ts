import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { authorizeSceneMutation } from '@/lib/auth/guard'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

const schema = z.object({ version: z.number().int().positive() })

/**
 * POST /api/scenes/[id]/revisions/restore — bring a retained version back.
 *
 * Restore is non-destructive: the chosen version's graph is saved as a NEW
 * head, so the state you restored from is itself retained as a backup and
 * nothing is overwritten in place. Requires write access (owner, an `editor`
 * share, or an admin). `expectedVersion` guards against restoring on top of a
 * change that landed while the backups dialog was open.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const operations = await getSceneOperations()
  if (!operations.canReadSceneRevisions) {
    return sceneApiJson(request, { error: 'revisions_unavailable' }, { status: 501 })
  }
  const scene = await operations.loadStoredScene(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  const auth = await authorizeSceneMutation(id, scene.ownerId ?? null)
  if (!auth.ok) return sceneApiJson(request, { error: auth.error }, { status: auth.status })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })

  const graph = await operations.loadSceneRevision(id, parsed.data.version)
  if (!graph) return sceneApiJson(request, { error: 'revision_not_found' }, { status: 404 })

  try {
    const meta = await operations.saveScene({
      id,
      name: scene.name,
      projectId: scene.projectId,
      ownerId: scene.ownerId,
      graph,
      thumbnailUrl: scene.thumbnailUrl,
      saveMode: 'checkpoint',
      publish: scene.published !== false,
      expectedVersion: scene.version,
    })
    return sceneApiJson(request, { ok: true, version: meta.version })
  } catch (error) {
    if ((error as { code?: string })?.code === 'version_conflict') {
      return sceneApiJson(request, { error: 'version_conflict' }, { status: 409 })
    }
    throw error
  }
}
