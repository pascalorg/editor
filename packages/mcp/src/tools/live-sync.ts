import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { syncAutoStairOpenings } from '@pascal-app/core/stair-openings'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { SceneVersionConflictError } from '../storage/types'
import { ErrorCode, throwMcpError } from './errors'

export function syncDerivedStairOpenings(operations: SceneOperations): number {
  const updates = syncAutoStairOpenings(operations.getNodes())
  if (updates.length === 0) return 0
  operations.applyPatch(
    updates.map((update) => ({
      op: 'update' as const,
      id: update.id,
      data: update.data,
    })),
  )
  return updates.length
}

export type LiveSyncStatus = 'published' | 'unbound' | 'events_unsupported'

type LiveSyncSkip = Exclude<LiveSyncStatus, 'published'>

/**
 * Output-schema fragment for every tool that mutates the scene. Spread into
 * the tool's `outputSchema` so `persistencePayload` fields survive the SDK's
 * structured-content validation.
 */
export const liveSyncOutput = {
  persistence: z
    .object({
      status: z.enum(['unbound', 'events_unsupported']),
      warning: z.string(),
    })
    .optional(),
}

const LIVE_SYNC_WARNINGS: Record<LiveSyncSkip, string> = {
  unbound:
    'The change was applied to the in-memory session only: no active scene is bound, so nothing was persisted and no live event reached subscribers. Bind a scene with save_scene or load_scene to persist changes.',
  events_unsupported:
    'The change was applied to the in-memory session only: the attached scene store does not support live scene events, so nothing was persisted.',
}

/**
 * Payload fragment matching `liveSyncOutput`: empty after a successful
 * publish, a `persistence` warning when the mutation stayed in-memory.
 */
export function persistencePayload(status: LiveSyncStatus): {
  persistence?: { status: LiveSyncSkip; warning: string }
} {
  if (status === 'published') return {}
  return { persistence: { status, warning: LIVE_SYNC_WARNINGS[status] } }
}

/**
 * Persist the bridge's current graph to the active scene and append a live
 * event for browser subscribers. Skips persistence — reporting why — when the
 * MCP session is not currently bound to a saved scene or the store cannot
 * append scene events; callers surface that through `persistencePayload` so
 * the skip is never silent (#725).
 */
export async function publishLiveSceneSnapshot(
  operations: SceneOperations,
  kind: string,
): Promise<LiveSyncStatus> {
  syncDerivedStairOpenings(operations)

  const active = operations.getActiveScene()
  if (!active) return 'unbound'
  if (!operations.canAppendSceneEvents) return 'events_unsupported'

  const graph = operations.exportSceneGraph()

  try {
    const meta = await operations.saveScene({
      id: active.id,
      name: active.name,
      projectId: active.projectId,
      ownerId: active.ownerId,
      thumbnailUrl: active.thumbnailUrl,
      graph,
      expectedVersion: active.version,
      saveMode: 'draft',
      publish: false,
      operation: kind,
    })
    operations.setActiveScene(meta)
    await operations.appendSceneEvent({
      sceneId: meta.id,
      version: meta.version,
      kind,
      graph,
    })
  } catch (error) {
    if (error instanceof SceneVersionConflictError) {
      throwMcpError(ErrorCode.InvalidRequest, 'live_sync_version_conflict', {
        sceneId: active.id,
        expectedVersion: active.version,
      })
    }
    const message = error instanceof Error ? error.message : String(error)
    throwMcpError(ErrorCode.InternalError, `live_sync_failed: ${message}`)
  }
  return 'published'
}

export async function appendLiveSceneEvent(
  operations: SceneOperations,
  sceneId: string,
  version: number,
  kind: string,
  graph: SceneGraph,
): Promise<void> {
  if (!operations.canAppendSceneEvents) return
  await operations.appendSceneEvent({ sceneId, version, kind, graph })
}
