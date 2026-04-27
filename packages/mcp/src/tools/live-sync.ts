import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { syncAutoStairOpenings } from '@pascal-app/core/stair-openings'
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

/**
 * Persist the bridge's current graph to the active scene and append a live
 * event for browser subscribers. No-ops when the MCP session is not currently
 * bound to a saved scene.
 */
export async function publishLiveSceneSnapshot(
  operations: SceneOperations,
  kind: string,
): Promise<void> {
  syncDerivedStairOpenings(operations)

  const active = operations.getActiveScene()
  if (!active || !operations.canAppendSceneEvents) return

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
