import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/admin'
import { publishSceneAsSite, unpublishScene } from '@/lib/auth/site-scenes'
import { guardSceneApiRequest, sceneApiJson } from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'

const schema = z.object({
  sceneId: z.string().min(1).max(64),
  publish: z.boolean(),
})

/**
 * POST /api/admin/scenes/publish — an admin approving (or withdrawing) a
 * project. Publishing puts the scene on Sites & Projects as an active site;
 * withdrawing removes the card and leaves the scene untouched, so the person
 * who drew it never loses work to a moderation decision.
 */
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
  if (!parsed.success) return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })

  if (!parsed.data.publish) {
    const removed = await unpublishScene(parsed.data.sceneId)
    return sceneApiJson(request, { published: false, changed: removed })
  }

  const result = await publishSceneAsSite(parsed.data.sceneId, admin.id)
  if (result === 'scene_not_found') {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }
  return sceneApiJson(request, { published: true, changed: result === 'published' })
}
