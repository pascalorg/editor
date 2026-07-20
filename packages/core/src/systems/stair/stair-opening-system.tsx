'use client'

import { useEffect, useRef } from 'react'
import type { AnyNode, AnyNodeId } from '../../schema'
import { pauseSceneHistory, resumeSceneHistory } from '../../store/history-control'
import useLiveNodeOverrides from '../../store/use-live-node-overrides'
import useLiveTransforms from '../../store/use-live-transforms'
import useScene from '../../store/use-scene'
import {
  createSurfaceOpeningPreviewController,
  getNodesWithLiveStairOpeningInputs,
  hasLiveStairOpeningInputs,
} from './stair-opening-preview'
import { syncAutoStairOpenings } from './stair-opening-sync'
import { syncDeckAttachedStairRises } from './stair-rise'

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

export const StairOpeningSystem = () => {
  const syncingAutoOpeningsRef = useRef(false)
  const syncingPreviewOpeningsRef = useRef(false)
  const previewControllerRef = useRef(createSurfaceOpeningPreviewController())

  useEffect(() => {
    const applyUpdates = (updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }>) => {
      if (updates.length === 0) return
      syncingAutoOpeningsRef.current = true
      pauseSceneHistory(useScene)
      try {
        useScene.getState().updateNodes(updates)
      } finally {
        resumeSceneHistory(useScene)
      }
      queueMicrotask(() => {
        syncingAutoOpeningsRef.current = false
      })
    }

    const applyPreviewUpdates = (updates: ReturnType<typeof syncAutoStairOpenings>) => {
      syncingPreviewOpeningsRef.current = true
      previewControllerRef.current.apply(updates)
      queueMicrotask(() => {
        syncingPreviewOpeningsRef.current = false
      })
    }

    const clearPreviewUpdates = () => {
      if (previewControllerRef.current.previewSurfaceIds.size === 0) return
      syncingPreviewOpeningsRef.current = true
      previewControllerRef.current.clear()
      queueMicrotask(() => {
        syncingPreviewOpeningsRef.current = false
      })
    }

    const refreshLivePreview = () => {
      if (syncingPreviewOpeningsRef.current) return

      const nodes = useScene.getState().nodes
      const liveTransforms = useLiveTransforms.getState().transforms
      const liveOverrides = useLiveNodeOverrides.getState().overrides
      const previewSurfaceIds = previewControllerRef.current.previewSurfaceIds

      if (!hasLiveStairOpeningInputs(nodes, liveTransforms, liveOverrides, previewSurfaceIds)) {
        clearPreviewUpdates()
        return
      }

      applyPreviewUpdates(
        syncAutoStairOpenings(
          getNodesWithLiveStairOpeningInputs(
            nodes,
            liveTransforms,
            liveOverrides,
            previewSurfaceIds,
          ),
        ),
      )
    }

    const runAutoSync = () => {
      // Rise first: deck-attached straight stairs write their flight heights
      // from the deck's elevation, and the opening pass reads those segment
      // heights — so it must run against the post-rise nodes.
      applyUpdates(syncDeckAttachedStairRises(useScene.getState().nodes))
      applyUpdates(syncAutoStairOpenings(useScene.getState().nodes))
    }

    runAutoSync()
    refreshLivePreview()

    const unsubscribeScene = useScene.subscribe((state, prevState) => {
      if (syncingAutoOpeningsRef.current) return
      if (!hasOpeningRelevantNodeChange(state.nodes, prevState.nodes)) return
      runAutoSync()
      refreshLivePreview()
    })

    const unsubscribeLiveTransforms = useLiveTransforms.subscribe(() => {
      refreshLivePreview()
    })

    const unsubscribeLiveOverrides = useLiveNodeOverrides.subscribe(() => {
      refreshLivePreview()
    })

    return () => {
      unsubscribeScene()
      unsubscribeLiveTransforms()
      unsubscribeLiveOverrides()
      previewControllerRef.current.clear()
    }
  }, [])

  return null
}
