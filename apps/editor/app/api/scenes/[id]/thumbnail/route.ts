import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { authorizeSceneMutation } from '@/lib/auth/guard'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

// The thumbnail is stored inline in the scenes row (thumbnail_url, a MySQL
// TEXT column capped at 65 535 bytes). A base64 data URL inflates the image by
// ~33%, so the client must downscale to a small JPEG; 60 000 chars leaves head
// room under the column limit. Larger payloads are a client bug, not user data.
const MAX_DATA_URL = 60_000

const schema = z.object({
  dataUrl: z.string().startsWith('data:image/').max(MAX_DATA_URL),
})

/**
 * POST /api/scenes/[id]/thumbnail — set the scene's card preview image.
 *
 * Called by the editor after a save captures a fresh snapshot. Writing only
 * the thumbnail column: no version bump, no revision, no live-sync event, so a
 * preview refresh never looks like an edit to collaborators.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const operations = await getSceneOperations()
  if (!operations.canUpdateThumbnail) {
    return sceneApiJson(request, { error: 'thumbnail_unavailable' }, { status: 501 })
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
  if (!parsed.success) {
    return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  }

  await operations.updateSceneThumbnail(id, parsed.data.dataUrl)
  return sceneApiJson(request, { ok: true })
}
