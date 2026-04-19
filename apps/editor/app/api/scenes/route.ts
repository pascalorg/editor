import { AnyNode } from '@pascal-app/core/schema'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSceneStore } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

/**
 * The `graph` payload must structurally match a SceneGraph AND every node
 * must pass `AnyNode.safeParse` (including the AssetUrl allowlist for
 * scan/guide/item/material URL fields). Without this revalidation, the
 * POST /api/scenes route would bypass the security hardening in A7. See
 * Phase 8 P4 report for the CVE-ish finding.
 */
const graphSchema = z
  .object({
    nodes: z.record(z.string(), z.unknown()),
    rootNodeIds: z.array(z.string()),
    collections: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    for (const [nodeId, node] of Object.entries(value.nodes)) {
      const res = AnyNode.safeParse(node)
      if (!res.success) {
        for (const issue of res.error.issues) {
          ctx.addIssue({
            code: 'custom',
            path: ['nodes', nodeId, ...issue.path],
            message: issue.message,
          })
        }
      }
    }
  })

const createSceneSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200).nullable().optional(),
  graph: graphSchema,
  thumbnailUrl: z.string().url().nullable().optional(),
})

const listQuerySchema = z.object({
  projectId: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
})

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const parsed = listQuerySchema.safeParse({
    projectId: url.searchParams.get('projectId') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const store = await getSceneStore()
  const scenes = await store.list({
    projectId: parsed.data.projectId,
    limit: parsed.data.limit,
  })
  return NextResponse.json({ scenes })
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', details: 'body must be valid JSON' },
      { status: 400 },
    )
  }

  const parsed = createSceneSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const store = await getSceneStore()
  try {
    const meta = await store.save({
      id: parsed.data.id,
      name: parsed.data.name,
      projectId: parsed.data.projectId ?? null,
      graph: parsed.data.graph as never,
      thumbnailUrl: parsed.data.thumbnailUrl ?? null,
    })
    return NextResponse.json(meta, {
      status: 201,
      headers: { Location: `/scene/${meta.id}` },
    })
  } catch (error) {
    return handleStoreError(error)
  }
}

function handleStoreError(error: unknown): NextResponse {
  const code = (error as { code?: string })?.code
  if (code === 'version_conflict') {
    return NextResponse.json({ error: 'version_conflict' }, { status: 409 })
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
