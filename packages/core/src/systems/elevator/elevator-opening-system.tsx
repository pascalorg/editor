'use client'

import { useEffect } from 'react'
import { structureChangeBatch } from '../../commands/structure/shared'
import type { AnyNode } from '../../schema'
import { pauseSceneHistory, resumeSceneHistory } from '../../store/history-control'
import { isHydrationNormalization } from '../../store/scene-hydration'
import useScene from '../../store/use-scene'
import { planOwnedFloorOpenings } from '../owned-floor-openings'
import { reconcileOwnedFloorOpeningChanges } from '../reconcile-owned-floor-openings'

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

  const applyChanges = (skipExistingSurfaces = false) => {
    const changes = planOwnedFloorOpenings(useScene.getState().nodes, { skipExistingSurfaces })
    if (changes.length === 0) return
    syncingAutoOpenings = true
    pauseSceneHistory(useScene)
    try {
      const before = useScene.getState().nodes
      useScene.getState().applyNodeChanges(structureChangeBatch(changes))
      reconcileOwnedFloorOpeningChanges(before, changes)
    } finally {
      resumeSceneHistory(useScene)
      syncingAutoOpenings = false
    }
  }

  applyChanges(true)

  return useScene.subscribe((state, prevState) => {
    if (syncingAutoOpenings) return
    if (!hasOpeningRelevantNodeChange(state.nodes, prevState.nodes)) return
    applyChanges(isHydrationNormalization() || state.hydrationId !== prevState.hydrationId)
  })
}

export const ElevatorOpeningSystem = () => {
  useEffect(() => initializeElevatorOpeningSync(), [])

  return null
}
