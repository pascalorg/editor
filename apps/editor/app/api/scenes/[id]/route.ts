import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiGraphSchema } from '@/lib/graph-schema'
import {
  guardSceneApiRequest,
  sceneApiJson,
  sceneApiPreflight,
  withSceneApiHeaders,
} from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

const putSceneSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  graph: apiGraphSchema,
  thumbnailUrl: z.string().url().nullable().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
})

const patchSceneSchema = z.object({
  name: z.string().min(1).max(200),
  expectedVersion: z.number().int().nonnegative().optional(),
})

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const operations = await getSceneOperations()
  try {
    const scene = await operations.loadStoredScene(id)
    if (!scene) {
      return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
    }
    return sceneApiJson(request, scene, {
      headers: { ETag: `"${scene.version}"` },
    })
  } catch (error) {
    return handleStoreError(request, error)
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params

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

  const parsed = putSceneSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const ifMatch = parseIfMatch(request.headers.get('If-Match'))
  const expectedVersion = ifMatch ?? parsed.data.expectedVersion

  const operations = await getSceneOperations()
  try {
    const existing = await operations.loadStoredScene(id)
    if (!existing) {
      return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
    }
    const meta = await operations.saveScene({
      id,
      name: parsed.data.name ?? existing.name,
      projectId: existing.projectId,
      ownerId: existing.ownerId,
      graph: parsed.data.graph as never,
      thumbnailUrl:
        parsed.data.thumbnailUrl === undefined ? existing.thumbnailUrl : parsed.data.thumbnailUrl,
      expectedVersion: expectedVersion ?? existing.version,
    })
    return sceneApiJson(request, meta, {
      headers: { ETag: `"${meta.version}"` },
    })
  } catch (error) {
    return handleStoreError(request, error, { includeCurrentVersionFor: id })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const ifMatch = parseIfMatch(request.headers.get('If-Match'))

  const operations = await getSceneOperations()
  try {
    const removed = await operations.deleteStoredScene(id, { expectedVersion: ifMatch })
    if (!removed) {
      return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
    }
    return withSceneApiHeaders(request, new NextResponse(null, { status: 204 }))
  } catch (error) {
    return handleStoreError(request, error, { includeCurrentVersionFor: id })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params

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

  const parsed = patchSceneSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const ifMatch = parseIfMatch(request.headers.get('If-Match'))
  const expectedVersion = ifMatch ?? parsed.data.expectedVersion

  const operations = await getSceneOperations()
  try {
    const meta = await operations.renameStoredScene(id, parsed.data.name, { expectedVersion })
    return sceneApiJson(request, meta, {
      headers: { ETag: `"${meta.version}"` },
    })
  } catch (error) {
    return handleStoreError(request, error, { includeCurrentVersionFor: id })
  }
}

/**
 * Parses an `If-Match` header value per RFC 7232. Accepts `"<version>"` or
 * weak `W/"<version>"` forms. Returns `undefined` when the header is absent,
 * the wildcard `*`, or unparseable as a non-negative integer.
 */
function parseIfMatch(raw: string | null): number | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (trimmed === '*') return undefined
  const match = trimmed.match(/^(?:W\/)?"([^"]+)"$/)
  const inner = match ? match[1] : trimmed
  if (!inner) return undefined
  const n = Number(inner)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return undefined
  return n
}

async function handleStoreError(
  request: NextRequest,
  error: unknown,
  opts: { includeCurrentVersionFor?: string } = {},
): Promise<NextResponse> {
  const code = (error as { code?: string })?.code
  if (code === 'version_conflict') {
    let currentVersion: number | undefined
    if (opts.includeCurrentVersionFor) {
      try {
        const operations = await getSceneOperations()
        const current = await operations.loadStoredScene(opts.includeCurrentVersionFor)
        currentVersion = current?.version
      } catch {
        // Best-effort; skip reporting currentVersion on secondary failure.
      }
    }
    return sceneApiJson(
      request,
      currentVersion === undefined
        ? { error: 'version_conflict' }
        : { error: 'version_conflict', currentVersion },
      { status: 409 },
    )
  }
  if (code === 'not_found') {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }
  if (code === 'too_large') {
    return sceneApiJson(request, { error: 'too_large' }, { status: 413 })
  }
  if (code === 'invalid') {
    return sceneApiJson(request, { error: 'invalid' }, { status: 400 })
  }
  const message = error instanceof Error ? error.message : 'unexpected_error'
  return sceneApiJson(request, { error: 'internal_error', message }, { status: 500 })
}
