import {
  applyCollaborationBatch,
  type CollaborationBatch,
  collaborationSnapshot,
} from '@pascal-app/core/collaboration'
import { z } from 'zod'
import { apiGraphSchema } from '@/lib/graph-schema'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

const nodeCreate = z.object({
  type: z.literal('node-create'),
  node: z.record(z.string(), z.unknown()),
  position: z.number().int().nonnegative(),
})
const nodeDelete = z.object({
  type: z.literal('node-delete'),
  nodeId: z.string().min(1),
})
const nodeFields = z.object({
  type: z.literal('node-fields'),
  nodeId: z.string().min(1),
  removed: z.array(z.string()).max(256),
  values: z.record(z.string(), z.unknown()),
})
const nodeMove = z.object({
  type: z.literal('node-move'),
  nodeId: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  position: z.number().int().nonnegative(),
})
const recordSet = z.object({
  type: z.literal('record-set'),
  record: z.enum(['collections', 'definitions', 'materials', 'savedViews']),
  id: z.string().min(1),
  value: z.unknown().nullable(),
})
const installedPluginsSet = z.object({
  type: z.literal('installed-plugins-set'),
  value: z.array(z.string().min(1)).max(256),
})
const collaborationBatchSchema = z.object({
  protocol: z.literal(1),
  actorId: z.string().min(1).max(128),
  clock: z.number().int().nonnegative(),
  operationId: z.string().min(1).max(128),
  changes: z
    .array(
      z.discriminatedUnion('type', [
        nodeCreate,
        nodeDelete,
        nodeFields,
        nodeMove,
        recordSet,
        installedPluginsSet,
      ]),
    )
    .min(1)
    .max(20_000),
})

export function OPTIONS(request: Request) {
  return sceneApiPreflight(request)
}

export async function POST(request: Request, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
  }
  const parsed = collaborationBatchSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const { id } = await params
  const operations = await getSceneOperations()
  const eventKind = `collaboration:${parsed.data.actorId}:${parsed.data.operationId}`
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const scene = await operations.loadStoredScene(id)
    if (!scene) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })

    const graph = scene.graph
    const baseline = collaborationSnapshot(graph.nodes, graph.rootNodeIds, graph)
    const applied = applyCollaborationBatch(baseline, parsed.data as CollaborationBatch)
    const candidate = {
      ...graph,
      ...applied.snapshot,
      comments: graph.comments,
    }
    const validated = apiGraphSchema.safeParse(candidate)
    if (!validated.success) {
      return sceneApiJson(
        request,
        { error: 'invalid_collaboration_result', details: validated.error.issues },
        { status: 400 },
      )
    }

    try {
      const meta = await operations.saveScene({
        id,
        name: scene.name,
        projectId: scene.projectId,
        ownerId: scene.ownerId,
        thumbnailUrl: scene.thumbnailUrl,
        graph: validated.data as never,
        expectedVersion: scene.version,
        operation: eventKind,
      })
      const event = await operations.appendSceneEvent({
        sceneId: id,
        version: meta.version,
        kind: eventKind,
      })
      // The broadcast event carries no graph, but this response does: the
      // publisher needs the merged result to reconcile against, it is one
      // reader rather than every subscriber, and the server already has it in
      // hand — making them refetch what it just computed would be a round trip
      // for nothing.
      return sceneApiJson(
        request,
        { event, graph: validated.data, conflicts: applied.conflicts },
        { status: 201 },
      )
    } catch (error) {
      if ((error as { code?: string })?.code === 'version_conflict' && attempt < 3) continue
      const code = (error as { code?: string })?.code
      if (code === 'too_large') {
        return sceneApiJson(request, { error: 'too_large' }, { status: 413 })
      }
      if (code === 'invalid') {
        return sceneApiJson(request, { error: 'invalid' }, { status: 400 })
      }
      const message = error instanceof Error ? error.message : 'unexpected_error'
      return sceneApiJson(request, { error: 'internal_error', message }, { status: 500 })
    }
  }

  return sceneApiJson(request, { error: 'version_conflict' }, { status: 409 })
}
