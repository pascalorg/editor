import type { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiGraphSchema } from '@/lib/graph-schema'
import {
  authorizeProject,
  guardSceneApiRequest,
  resolveActor,
  sceneApiJson,
  sceneApiPreflight,
} from '@/lib/scene-api-security'
import {
  evaluateSceneQuota,
  measureSceneUsage,
  quotaViolationMessage,
  resolveSceneQuotas,
  sceneBytes,
  tierForActor,
} from '@/lib/scene-quota'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

const createSceneSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200).nullable().optional(),
  graph: apiGraphSchema,
  thumbnailUrl: z.string().url().nullable().optional(),
})

const listQuerySchema = z.object({
  projectId: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
})

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function GET(request: NextRequest) {
  const guard = await guardSceneApiRequest(request)
  if (guard) return guard

  const actor = await resolveActor(request)

  const url = new URL(request.url)
  const parsed = listQuerySchema.safeParse({
    projectId: url.searchParams.get('projectId') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const operations = await getSceneOperations()

  if (parsed.data.projectId) {
    const access = await authorizeProject(actor, parsed.data.projectId, 'read')
    if (!access) return sceneApiJson(request, { scenes: [] })

    const scenes = await operations.listScenes({
      projectId: parsed.data.projectId,
      limit: parsed.data.limit,
    })
    return sceneApiJson(request, { scenes })
  }

  // If no projectId is given, we just list scenes owned by the user (or nothing if anon)
  if (actor.type !== 'user') return sceneApiJson(request, { scenes: [] })

  const scenes = await operations.listScenes({
    ownerId: actor.userId,
    limit: parsed.data.limit,
  })
  return sceneApiJson(request, { scenes })
}

export async function POST(request: NextRequest) {
  const guard = await guardSceneApiRequest(request)
  if (guard) return guard

  const actor = await resolveActor(request)

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

  const parsed = createSceneSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const operations = await getSceneOperations()

  // Per-tier quota: scene count, per-scene size and total storage. Guests are
  // anonymous accounts, free is a verified account; both now carry a limit.
  if (actor.type === 'user') {
    const limits = resolveSceneQuotas()[tierForActor(actor)]
    const userScenes = await operations.listScenes({
      ownerId: actor.userId,
      limit: limits.maxScenes + 1,
    })
    const violation = evaluateSceneQuota(
      limits,
      measureSceneUsage(userScenes),
      sceneBytes(parsed.data.graph),
      true,
    )
    if (violation) {
      return sceneApiJson(
        request,
        { error: 'quota_exceeded', details: quotaViolationMessage(violation) },
        { status: 403 },
      )
    }
  }

  try {
    const meta = await operations.saveScene({
      id: parsed.data.id,
      name: parsed.data.name,
      projectId: parsed.data.projectId ?? null,
      ownerId: actor.type === 'user' ? actor.userId : null,
      graph: parsed.data.graph as never,
      thumbnailUrl: parsed.data.thumbnailUrl ?? null,
    })
    return sceneApiJson(request, meta, {
      status: 201,
      headers: { Location: `/scene/${meta.id}` },
    })
  } catch (error) {
    return handleStoreError(request, error)
  }
}

function handleStoreError(request: NextRequest, error: unknown): NextResponse {
  const code = (error as { code?: string })?.code
  if (code === 'version_conflict') {
    return sceneApiJson(request, { error: 'version_conflict' }, { status: 409 })
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
