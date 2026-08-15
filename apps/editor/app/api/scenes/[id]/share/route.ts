import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'
import { createShareToken } from '@/lib/share-token'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

const MAX_TTL_SECONDS = 365 * 24 * 60 * 60

const createShareSchema = z.object({
  /** Seconds until the link stops working. Omit or 0 for a link that never expires. */
  ttlSeconds: z.number().int().nonnegative().max(MAX_TTL_SECONDS).optional(),
})

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

/**
 * Mint a view-only link for a scene. Guarded by the ordinary scene-API auth:
 * handing out a share link is an owner action, and only the *use* of the link
 * is unauthenticated.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params

  let body: unknown = {}
  const raw = await request.text()
  if (raw.trim()) {
    try {
      body = JSON.parse(raw)
    } catch {
      return sceneApiJson(
        request,
        { error: 'invalid_request', details: 'body must be valid JSON' },
        { status: 400 },
      )
    }
  }

  const parsed = createShareSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  // Refuse to mint a link to a scene that isn't there — a 404 now beats a
  // working-looking URL that 404s for whoever it was sent to.
  const operations = await getSceneOperations()
  const scene = await operations.loadStoredScene(id)
  if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  const minted = createShareToken(id, { ttlSeconds: parsed.data.ttlSeconds })
  if (!minted) {
    // Same shape as the scene API's missing-token response: a deployment
    // configuration problem, not a client error.
    return sceneApiJson(request, { error: 'share_secret_required' }, { status: 503 })
  }

  const url = new URL(`/share/${minted.token}`, request.url)
  return sceneApiJson(request, {
    token: minted.token,
    url: url.toString(),
    expiresAt: minted.payload.exp ? new Date(minted.payload.exp * 1000).toISOString() : null,
  })
}

export function GET(request: NextRequest) {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 })
}
