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
 * event for browser subscribers.
 *
 * Throws an error when the MCP session has a SceneStore but is not bound to
 * an active scene, so the caller (and the LLM) gets clear feedback that a
 * scene must be loaded or created first via `load_scene` / `create_project` /
 * `create_house_from_brief`.
 *
 * Silently returns when no SceneStore is attached (headless / test mode).
 */
export async function publishLiveSceneSnapshot(
  operations: SceneOperations,
  kind: string,
): Promise<void> {
  syncDerivedStairOpenings(operations)

  const active = operations.getActiveScene()

  if (!active && operations.hasStore) {
    throwMcpError(
      ErrorCode.InvalidRequest,
      'no_active_scene: call load_scene, create_project, or create_house_from_brief before using mutation tools',
    )
  }

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
