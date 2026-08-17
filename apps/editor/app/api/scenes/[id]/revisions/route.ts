import type { NextRequest } from 'next/server'
import { authorizeSceneRead } from '@/lib/auth/guard'
import { publishedSceneIds } from '@/lib/auth/site-scenes'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * GET /api/scenes/[id]/revisions — the scene's retained past versions (the
 * "backups" list). Same read rule as the scene itself: owner, an account it's
 * shared with, an admin, or anyone if it's published.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const operations = await getSceneOperations()
  if (!operations.canReadSceneRevisions) {
    return sceneApiJson(request, { error: 'revisions_unavailable' }, { status: 501 })
  }
  const scene = await operations.loadStoredScene(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  const auth = await authorizeSceneRead(id, scene.ownerId ?? null, {
    published: (await publishedSceneIds()).has(id),
  })
  if (!auth.ok) return sceneApiJson(request, { error: auth.error }, { status: auth.status })

  const revisions = await operations.listSceneRevisions(id)
  // The scene's current head is the live version, not a backup — the list is
  // only the older ones a restore could return to.
  return sceneApiJson(request, {
    current: scene.version,
    revisions: revisions.filter((r) => r.version !== scene.version),
  })
}
