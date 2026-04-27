import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { syncAutoStairOpenings } from '@pascal-app/core/stair-openings'
import type { SceneBridge } from '../bridge/scene-bridge'
import { type SceneStore, SceneVersionConflictError } from '../storage/types'
import { ErrorCode, throwMcpError } from './errors'

export function syncDerivedStairOpenings(bridge: SceneBridge): number {
  const updates = syncAutoStairOpenings(bridge.getNodes())
  if (updates.length === 0) return 0
  bridge.applyPatch(
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
  bridge: SceneBridge,
  store: SceneStore | undefined,
  kind: string,
): Promise<void> {
  syncDerivedStairOpenings(bridge)

  const active = bridge.getActiveScene()
  if (!active || !store?.appendSceneEvent) return

  const exported = bridge.exportJSON()
  const graph: SceneGraph = {
    nodes: exported.nodes,
    rootNodeIds: exported.rootNodeIds,
    collections: exported.collections as SceneGraph['collections'],
  }

  try {
    const meta = await store.save({
      id: active.id,
      name: active.name,
      projectId: active.projectId,
      ownerId: active.ownerId,
      thumbnailUrl: active.thumbnailUrl,
      graph,
      expectedVersion: active.version,
    })
    bridge.setActiveScene(meta)
    await store.appendSceneEvent({
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
  store: SceneStore,
  sceneId: string,
  version: number,
  kind: string,
  graph: SceneGraph,
): Promise<void> {
  if (!store.appendSceneEvent) return
  await store.appendSceneEvent({ sceneId, version, kind, graph })
}
