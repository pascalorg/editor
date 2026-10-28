'use client'

import {
  type AnyNodeId,
  foundationViewHiddenIds,
  isCaptureSessionOn,
  sceneRegistry,
  subscribeCaptureSessions,
  useScene,
} from '@pascal-app/core'
import { foundationViewBuildingId, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useSyncExternalStore } from 'react'

/** Gives each object of `hidden` but those in `keep` back its own `visible`. */
function restore(hidden: Set<string>, keep: ReadonlySet<string> = new Set()) {
  const nodes = useScene.getState().nodes
  for (const id of hidden) {
    if (keep.has(id)) continue
    const object = sceneRegistry.nodes.get(id as AnyNodeId)
    if (object) object.visible = nodes[id as AnyNodeId]?.visible !== false
    hidden.delete(id)
  }
}

/**
 * Hides the house over its foundation every frame (the host redraws visibility as it likes) and
 * gives each object back its own `visible` after: what `foundationViewHiddenIds` names, so the
 * concrete the engine draws, the footings and a framing plugin's foundation stay. What it hides
 * takes no pointer either (`hiddenByFoundationView`, in `useNodeEvents`).
 */
function HiddenHouse() {
  const hidden = useRef(new Set<string>())
  useEffect(() => {
    const ids = hidden.current
    return () => restore(ids)
  }, [])
  useFrame(() => {
    const buildingId = foundationViewBuildingId()
    const ids = new Set(
      buildingId ? foundationViewHiddenIds(useScene.getState().nodes, buildingId) : [],
    )
    restore(hidden.current, ids)
    for (const id of ids) {
      const object = sceneRegistry.nodes.get(id as AnyNodeId)
      if (!object) continue
      if (object.visible) object.visible = false
      hidden.current.add(id)
    }
  })
  return null
}

/**
 * The 3D side of the foundation view (`useViewer.foundationView`): the house steps aside so its
 * foundation and footings show, the ground thinned to its veil (`groundSheer`). Bones need not be
 * installed. With Framing only on too, the frame stays over the foundation. A picture and the
 * walkthrough show the finished house.
 */
export function FoundationViewShell() {
  const on = useViewer((state) => state.foundationView && !state.walkthroughMode)
  const capturing = useSyncExternalStore(subscribeCaptureSessions, isCaptureSessionOn, () => false)
  return on && !capturing ? <HiddenHouse /> : null
}
