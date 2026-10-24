'use client'

import { useEffect } from 'react'
import type { AnyNode, AnyNodeId } from '../../schema'
import { roofsKeptOverStorey } from '../../services/roof-move'
import { isSettlingDocument } from '../../store/document-settling'
import {
  getSceneHistoryPauseDepth,
  notifySceneCommit,
  pauseSceneHistory,
  resumeSceneHistory,
  type SceneSnapshot,
} from '../../store/history-control'
import useScene from '../../store/use-scene'
import { isRoofElevationInput, planRoofElevationUpdates } from './roof-elevation'

function sceneSnapshot(): SceneSnapshot {
  const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
  return { nodes, rootNodeIds, collections, materials, installedPlugins }
}

export function initializeRoofElevationSync(): () => void {
  let disposed = false
  let queued = false
  let syncing = false
  // The nodes before this pass's first change: a roof above its storey keeps its height over it.
  let changedFrom: Readonly<Record<string, AnyNode>> | null = null

  const schedule = (previous: Readonly<Record<string, AnyNode>> | null = null) => {
    if (queued) return
    queued = true
    changedFrom = previous
    // Wall bases use the spatial grid, whose listener must finish before this pass.
    queueMicrotask(() => {
      queued = false
      if (disposed) return
      const { nodes, updateNodes, readOnly } = useScene.getState()
      if (readOnly) return
      const updates = [
        ...(changedFrom ? roofsKeptOverStorey(changedFrom, nodes) : []),
        ...planRoofElevationUpdates(nodes),
      ]
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
    if (syncing || state.nodes === previous.nodes || isSettlingDocument(useScene)) return
    const ids = new Set([...Object.keys(state.nodes), ...Object.keys(previous.nodes)])
    for (const id of ids) {
      const next = state.nodes[id as AnyNodeId]
      const prev = previous.nodes[id as AnyNodeId]
      if (next !== prev && (isRoofElevationInput(next) || isRoofElevationInput(prev))) {
        schedule(previous.nodes)
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
