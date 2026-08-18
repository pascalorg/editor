import { applySceneDelta, SCENE_DELTA_RECORDS, type SceneDelta } from '@pascal-app/core/scene-delta'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { wouldEmptyStoredScene } from '@/app/api/scenes/[id]/route'
import { apiGraphSchema } from '@/lib/graph-schema'
import { readJsonBody } from '@/lib/request-body'
import {
  authorizeScene,
  guardSceneApiRequest,
  resolveActor,
  sceneApiJson,
  sceneApiPreflight,
} from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

/**
 * Nodes arrive as opaque records and are validated once, as part of the graph
 * they produce — a node that is individually well-formed can still be invalid
 * in place (a wall parented to a deleted level), and `apiGraphSchema` is what
 * knows the difference. It is also the same gate the full PUT goes through, so
 * neither path can accept a graph the other would refuse.
 */
const setOp = z.object({
  op: z.literal('set'),
  id: z.string().min(1).max(128),
  node: z.record(z.string(), z.unknown()),
})
const deleteOp = z.object({
  op: z.literal('delete'),
  id: z.string().min(1).max(128),
})
const rootsOp = z.object({
  op: z.literal('roots'),
  rootNodeIds: z.array(z.string().min(1).max(128)).max(20_000),
})
const recordOp = z.object({
  op: z.literal('record'),
  record: z.enum(SCENE_DELTA_RECORDS),
  value: z.unknown(),
})

const patchSchema = z.object({
  baseVersion: z.number().int().nonnegative(),
  ops: z
    .array(z.discriminatedUnion('op', [setOp, deleteOp, rootsOp, recordOp]))
    .min(1)
    .max(20_000),
})

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = await guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const actor = await resolveActor(request)
  const access = await authorizeScene(actor, id, 'write')
  if (!access) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch (error) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: (error as Error).message },
      { status: 400 },
    )
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const operations = await getSceneOperations()
  try {
    const existing = await operations.loadStoredScene(id)
    if (!existing) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

    // The delta describes a change *from* one specific version. Applied to any
    // other, it silently reintroduces nodes someone else deleted and drops
    // fields someone else wrote — so a mismatch is reported, never merged. The
    // client falls back to a full PUT, which is why this path can stay strict.
    if (existing.version !== parsed.data.baseVersion) {
      return sceneApiJson(
        request,
        { error: 'version_conflict', currentVersion: existing.version },
        { status: 409 },
      )
    }

    const applied = applySceneDelta(existing.graph, parsed.data as unknown as SceneDelta)

    // Same guard as the full PUT: a delta that deletes every node is the
    // transient state between scenes far more often than an intent, and the
    // client is the wrong place for the only check.
    if (wouldEmptyStoredScene(applied, existing.graph)) {
      return sceneApiJson(request, { error: 'refused_empty_graph' }, { status: 409 })
    }

    const validated = apiGraphSchema.safeParse(applied)
    if (!validated.success) {
      return sceneApiJson(
        request,
        { error: 'invalid_patch_result', details: validated.error.issues },
        { status: 400 },
      )
    }

    const meta = await operations.saveScene({
      id,
      name: existing.name,
      projectId: existing.projectId,
      ownerId: existing.ownerId,
      thumbnailUrl: existing.thumbnailUrl,
      graph: validated.data as never,
      expectedVersion: existing.version,
      saveMode: 'draft',
    })

    // No scene event: this is the autosave path, and the full PUT it replaces
    // does not announce either. Announcing here would have every other
    // subscriber answer each keystroke with a full graph fetch — the cost this
    // endpoint exists to remove, moved to the read side.
    return sceneApiJson(
      request,
      { version: meta.version },
      { headers: { ETag: `"${meta.version}"` } },
    )
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code === 'version_conflict') {
      const current = await operations.loadStoredScene(id).catch(() => null)
      return sceneApiJson(
        request,
        { error: 'version_conflict', currentVersion: current?.version },
        { status: 409 },
      )
    }
    if (code === 'too_large') return sceneApiJson(request, { error: 'too_large' }, { status: 413 })
    if (code === 'invalid') return sceneApiJson(request, { error: 'invalid' }, { status: 400 })
    const message = error instanceof Error ? error.message : 'unexpected_error'
    return sceneApiJson(request, { error: 'internal_error', message }, { status: 500 })
  }
}
