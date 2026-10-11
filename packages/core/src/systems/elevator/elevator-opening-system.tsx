'use client'

import { useEffect } from 'react'
import { structureChangeBatch } from '../../commands/structure/shared'
import { isSettlingDocument } from '../../store/document-settling'
import { pauseSceneHistory, resumeSceneHistory } from '../../store/history-control'
import { isHydrationNormalization } from '../../store/scene-hydration'
import useScene from '../../store/use-scene'
import { changedInputs, isElevatorOpeningInput } from '../document-reconcile'
import { planOwnedFloorOpenings } from '../owned-floor-openings'
import { reconcileOwnedFloorOpeningChanges } from '../reconcile-owned-floor-openings'

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
      reconcileOwnedFloorOpeningChanges(useScene, before, changes)
    } finally {
      resumeSceneHistory(useScene)
      syncingAutoOpenings = false
    }
  }

  applyChanges(true)

  return useScene.subscribe((state, prevState) => {
    if (syncingAutoOpenings || isSettlingDocument(useScene)) return
    if (!changedInputs(prevState.nodes, state.nodes, isElevatorOpeningInput)) return
    applyChanges(isHydrationNormalization() || state.hydrationId !== prevState.hydrationId)
  })
}

export const ElevatorOpeningSystem = () => {
  useEffect(() => initializeElevatorOpeningSync(), [])

  return null
}
