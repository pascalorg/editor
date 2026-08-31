'use client'

import { useEffect } from 'react'
import type { AnyNode } from '../../schema'
import { pauseSceneHistory, resumeSceneHistory } from '../../store/history-control'
import useScene from '../../store/use-scene'
import { syncAutoElevatorOpenings } from './elevator-opening-sync'

function isOpeningRelevantNode(node: AnyNode | undefined) {
  return (
    node?.type === 'building' ||
    node?.type === 'ceiling' ||
    node?.type === 'elevator' ||
    node?.type === 'level' ||
    node?.type === 'slab'
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

export function initializeElevatorOpeningSync() {
  let syncingAutoOpenings = false

  const applyUpdates = (updates: ReturnType<typeof syncAutoElevatorOpenings>) => {
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

  applyUpdates(syncAutoElevatorOpenings(useScene.getState().nodes))

  return useScene.subscribe((state, prevState) => {
    if (syncingAutoOpenings) return
    if (!hasOpeningRelevantNodeChange(state.nodes, prevState.nodes)) return
    applyUpdates(syncAutoElevatorOpenings(state.nodes))
  })
}

export const ElevatorOpeningSystem = () => {
  useEffect(() => initializeElevatorOpeningSync(), [])

  return null
}
