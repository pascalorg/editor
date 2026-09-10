'use client'

import { useEffect } from 'react'
import type { AnyNode, AnyNodeId } from '../../schema'
import {
  getSceneHistoryPauseDepth,
  notifySceneCommit,
  pauseSceneHistory,
  resumeSceneHistory,
  type SceneSnapshot,
} from '../../store/history-control'
import useScene from '../../store/use-scene'
import { resolveRoofElevation } from './roof-elevation'

const ROOF_ELEVATION_EPSILON = 1e-4

function sceneSnapshot(): SceneSnapshot {
  const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
  return { nodes, rootNodeIds, collections, materials, installedPlugins }
}

function isElevationRelevant(node: AnyNode | undefined): boolean {
  return (
    node?.type === 'roof' ||
    node?.type === 'wall' ||
    node?.type === 'slab' ||
    node?.type === 'level' ||
    node?.type === 'building' ||
    node?.type === 'site'
  )
}

export function initializeRoofElevationSync(): () => void {
  let disposed = false
  let queued = false
  let syncing = false

  const schedule = () => {
    if (queued) return
    queued = true
    // Wall bases use the spatial grid, whose listener must finish before this pass.
    queueMicrotask(() => {
      queued = false
      if (disposed) return
      const { nodes, updateNodes, readOnly } = useScene.getState()
      if (readOnly) return
      const updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []
      for (const node of Object.values(nodes)) {
        if (node.type !== 'roof' || node.support?.kind !== 'walls') continue
        const elevation = resolveRoofElevation(node, nodes)
        if (Math.abs(node.position[1] - elevation) <= ROOF_ELEVATION_EPSILON) continue
        updates.push({
          id: node.id,
          data: { position: [node.position[0], elevation, node.position[2]] },
        })
      }
      if (updates.length === 0) return
      const before = sceneSnapshot()
      const publishCommit =
        useScene.temporal.getState().isTracking && getSceneHistoryPauseDepth() === 0
      syncing = true
      pauseSceneHistory(useScene)
      try {
        updateNodes(updates)
      } finally {
        resumeSceneHistory(useScene)
        syncing = false
      }
      // Deferred writes miss the originating commit; publish the settled roof without
      // another undo step. An outer pause belongs to a gesture that owns its commit.
      if (publishCommit) {
        notifySceneCommit({
          origin: 'local',
          before,
          current: sceneSnapshot(),
          changedNodeIds: new Set(updates.map(({ id }) => id)),
        })
      }
    })
  }

  const unsubscribe = useScene.subscribe((state, previous) => {
    if (syncing || state.nodes === previous.nodes) return
    const ids = new Set([...Object.keys(state.nodes), ...Object.keys(previous.nodes)])
    for (const id of ids) {
      const next = state.nodes[id as AnyNodeId]
      const prev = previous.nodes[id as AnyNodeId]
      if (next !== prev && (isElevationRelevant(next) || isElevationRelevant(prev))) {
        schedule()
        return
      }
    }
  })
  schedule()

  return () => {
    disposed = true
    unsubscribe()
  }
}

export function RoofElevationSystem() {
  useEffect(initializeRoofElevationSync, [])
  return null
}
