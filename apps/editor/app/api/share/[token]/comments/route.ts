// The `/schema` subpath, not the package root: a route handler must not pull
// in the client half of core (stores, hooks) the way the root barrel does.
import { normalizeComments } from '@pascal-app/core/schema'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'
import { verifyShareToken } from '@/lib/share-token'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ token: string }> }

const commentsSchema = z.object({
  comments: z.record(z.string(), z.unknown()),
})

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

/**
 * The one write a view-only visitor is allowed.
 *
 * The body carries comments and nothing else, and the handler never merges it
 * into the graph wholesale: it loads the stored scene, replaces *only* the
 * `comments` bag, and writes that back. A visitor who posts nodes, materials or
 * a whole graph changes nothing — the extra keys are not read. That is the
 * property the whole feature rests on, so it is enforced here on the server
 * rather than by the client sending a narrow body.
 *
 * Deliberately not behind `guardSceneApiRequest`'s auth: the signed token *is*
 * the authorization, and the visitor has no API credentials. Origin checks and
 * rate limiting still apply through `sceneApiPreflight` / the shared headers.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { token } = await params
  const verified = verifyShareToken(token)
  if (!verified.ok) {
    const status = verified.error === 'secret_missing' ? 503 : 403
    return sceneApiJson(request, { error: verified.error }, { status })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: 'body must be valid JSON' },
      { status: 400 },
    )
  }

  const parsed = commentsSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  // Coerced through the same normalizer the editor loads with, so a malformed
  // or oversized thread cannot be written into the scene file for everyone else
  // to choke on.
  const comments = normalizeComments(parsed.data.comments)

  const operations = await getSceneOperations()
  const scene = await operations.loadStoredScene(verified.payload.sid)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  try {
    const meta = await operations.saveScene({
      id: scene.id,
      name: scene.name,
      projectId: scene.projectId,
      ownerId: scene.ownerId,
      graph: { ...(scene.graph as object), comments } as never,
      thumbnailUrl: scene.thumbnailUrl,
      expectedVersion: scene.version,
    })
    return sceneApiJson(request, { version: meta.version })
  } catch (error) {
    // A version conflict means the owner saved between our read and write. The
    // client re-sends on the next debounce, so a plain 409 is enough.
    const code = (error as { code?: string })?.code
    if (code === 'version_conflict') {
      return sceneApiJson(request, { error: 'version_conflict' }, { status: 409 })
    }
    if (code === 'too_large') {
      return sceneApiJson(request, { error: 'too_large' }, { status: 413 })
    }
    return sceneApiJson(request, { error: 'store_error' }, { status: 500 })
  }
}
