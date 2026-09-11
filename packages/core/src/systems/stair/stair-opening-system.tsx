'use client'

import { useEffect } from 'react'
import type { AnyNode, AnyNodeId } from '../../schema'
import { pauseSceneHistory, resumeSceneHistory } from '../../store/history-control'
import { queueSceneNormalization } from '../../store/scene-hydration'
import useLiveNodeOverrides from '../../store/use-live-node-overrides'
import useLiveTransforms from '../../store/use-live-transforms'
import useScene from '../../store/use-scene'
import {
  createSurfaceOpeningPreviewController,
  getNodesWithLiveStairOpeningInputs,
  hasLiveStairOpeningInputs,
} from './stair-opening-preview'
import { syncAutoStairOpenings } from './stair-opening-sync'
import { syncStairRises } from './stair-rise'

function isOpeningRelevantNode(node: AnyNode | undefined) {
  return (
    node?.type === 'building' ||
    node?.type === 'ceiling' ||
    node?.type === 'level' ||
    node?.type === 'slab' ||
    node?.type === 'stair' ||
    node?.type === 'stair-segment'
  )
}

function hasOpeningRelevantNodeChange(
  nextNodes: Record<string, AnyNode>,
  prevNodes: Record<string, AnyNode>,
) {
  if (nextNodes === prevNodes) return false

  const ids = new Set([...Object.keys(nextNodes), ...Object.keys(prevNodes)])
  for (const id of ids) {
    const nextNode = nextNodes[id]
    const prevNode = prevNodes[id]
    if (nextNode === prevNode) continue
    if (isOpeningRelevantNode(nextNode) || isOpeningRelevantNode(prevNode)) return true
  }

  return false
}

export function initializeStairOpeningSync() {
  let syncingAutoOpenings = false
  let syncingPreviewOpenings = false
  const previewController = createSurfaceOpeningPreviewController()
  const applyUpdates = (updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }>) => {
    if (updates.length === 0) return
    syncingAutoOpenings = true
    pauseSceneHistory(useScene)
    try {
      useScene.getState().updateNodes(updates)
    } finally {
      resumeSceneHistory(useScene)
      syncingAutoOpenings = false
    }
  }

  const applyPreviewUpdates = (updates: ReturnType<typeof syncAutoStairOpenings>) => {
    syncingPreviewOpenings = true
    previewController.apply(updates)
    queueMicrotask(() => {
      syncingPreviewOpenings = false
    })
  }

  const clearPreviewUpdates = () => {
    if (previewController.previewSurfaceIds.size === 0) return
    syncingPreviewOpenings = true
    previewController.clear()
    queueMicrotask(() => {
      syncingPreviewOpenings = false
    })
  }

  const refreshLivePreview = () => {
    if (syncingPreviewOpenings) return

    const nodes = useScene.getState().nodes
    const liveTransforms = useLiveTransforms.getState().transforms
    const liveOverrides = useLiveNodeOverrides.getState().overrides
    const previewSurfaceIds = previewController.previewSurfaceIds

    if (!hasLiveStairOpeningInputs(nodes, liveTransforms, liveOverrides, previewSurfaceIds)) {
      clearPreviewUpdates()
      return
    }

    applyPreviewUpdates(
      syncAutoStairOpenings(
        getNodesWithLiveStairOpeningInputs(nodes, liveTransforms, liveOverrides, previewSurfaceIds),
      ),
    )
  }

  const runAutoSync = () => {
    // Rise first: straight stairs converge their flight heights to the
    // resolved rise (level height or deck elevation), and the opening pass
    // reads those segment heights — so it must run against the post-rise
    // nodes.
    applyUpdates(syncStairRises(useScene.getState().nodes))
    applyUpdates(syncAutoStairOpenings(useScene.getState().nodes))
  }

  let disposed = false
  let syncGeneration = 0
  const scheduleAutoSync = () => {
    const generation = ++syncGeneration
    // One microtask later so every other scene-store listener for the
    // triggering transition (and, at mount, the editor's spatial-grid
    // init) runs first — the spatial-grid sync in particular. The
    // deck-attached rise elects the stair's floor-stack base elevation
    // through the spatial grid; syncing before the grid listener would
    // rescale flights against the pre-transition slab state.
    queueSceneNormalization(() => {
      if (disposed || generation !== syncGeneration) return
      runAutoSync()
      refreshLivePreview()
    })
  }

  scheduleAutoSync()

  const unsubscribeScene = useScene.subscribe((state, prevState) => {
    if (syncingAutoOpenings) return
    if (!hasOpeningRelevantNodeChange(state.nodes, prevState.nodes)) return
    scheduleAutoSync()
  })

  const unsubscribeLiveTransforms = useLiveTransforms.subscribe(() => {
    refreshLivePreview()
  })

  const unsubscribeLiveOverrides = useLiveNodeOverrides.subscribe(() => {
    refreshLivePreview()
  })

  return () => {
    disposed = true
    unsubscribeScene()
    unsubscribeLiveTransforms()
    unsubscribeLiveOverrides()
    previewController.clear()
  }
}

export const StairOpeningSystem = () => {
  useEffect(() => initializeStairOpeningSync(), [])
  return null
}
