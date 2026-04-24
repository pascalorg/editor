import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiGraphSchema } from '@/lib/graph-schema'
import { getSceneStore } from '@/lib/scene-store-server'

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

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const store = await getSceneStore()
  try {
    const scene = await store.load(id)
    if (!scene) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    return NextResponse.json(scene, {
      headers: { ETag: `"${scene.version}"` },
    })
  } catch (error) {
    return handleStoreError(error)
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', details: 'body must be valid JSON' },
      { status: 400 },
    )
  }

  const parsed = putSceneSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const ifMatch = parseIfMatch(request.headers.get('If-Match'))
  const expectedVersion = ifMatch ?? parsed.data.expectedVersion

  const store = await getSceneStore()
  try {
    const existing = await store.load(id)
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    const meta = await store.save({
      id,
      name: parsed.data.name ?? existing.name,
      projectId: existing.projectId,
      ownerId: existing.ownerId,
      graph: parsed.data.graph as never,
      thumbnailUrl:
        parsed.data.thumbnailUrl === undefined ? existing.thumbnailUrl : parsed.data.thumbnailUrl,
      expectedVersion: expectedVersion ?? existing.version,
    })
    return NextResponse.json(meta, {
      headers: { ETag: `"${meta.version}"` },
    })
  } catch (error) {
    return handleStoreError(error, { includeCurrentVersionFor: id })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const ifMatch = parseIfMatch(request.headers.get('If-Match'))

  const store = await getSceneStore()
  try {
    const removed = await store.delete(id, { expectedVersion: ifMatch })
    if (!removed) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return handleStoreError(error, { includeCurrentVersionFor: id })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', details: 'body must be valid JSON' },
      { status: 400 },
    )
  }

  const parsed = patchSceneSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const ifMatch = parseIfMatch(request.headers.get('If-Match'))
  const expectedVersion = ifMatch ?? parsed.data.expectedVersion

  const store = await getSceneStore()
  try {
    const meta = await store.rename(id, parsed.data.name, { expectedVersion })
    return NextResponse.json(meta, {
      headers: { ETag: `"${meta.version}"` },
    })
  } catch (error) {
    return handleStoreError(error, { includeCurrentVersionFor: id })
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
  error: unknown,
  opts: { includeCurrentVersionFor?: string } = {},
): Promise<NextResponse> {
  const code = (error as { code?: string })?.code
  if (code === 'version_conflict') {
    let currentVersion: number | undefined
    if (opts.includeCurrentVersionFor) {
      try {
        const store = await getSceneStore()
        const current = await store.load(opts.includeCurrentVersionFor)
        currentVersion = current?.version
      } catch {
        // Best-effort; skip reporting currentVersion on secondary failure.
      }
    }
    return NextResponse.json(
      currentVersion === undefined
        ? { error: 'version_conflict' }
        : { error: 'version_conflict', currentVersion },
      { status: 409 },
    )
  }
  if (code === 'not_found') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (code === 'too_large') {
    return NextResponse.json({ error: 'too_large' }, { status: 413 })
  }
  if (code === 'invalid') {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }
  const message = error instanceof Error ? error.message : 'unexpected_error'
  return NextResponse.json({ error: 'internal_error', message }, { status: 500 })
}
