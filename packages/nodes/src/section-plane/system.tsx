'use client'

import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import {
  clearSceneClippingPlanes,
  sceneClippingPlanes,
  setSceneClippingPlanes,
} from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import { Plane, Vector3 } from 'three'
import type { SectionPlaneNode } from './schema'

/**
 * At rest the cut normal is local -Y, so an unrotated plane keeps everything
 * below it. `flipped` swaps which half survives.
 */
const REST_NORMAL = new Vector3(0, -1, 0)
const FLIPPED_NORMAL = new Vector3(0, 1, 0)

const worldPlane = new Plane()
// Reused across frames so a plane drag allocates nothing.
const planeEquation = { normal: [0, -1, 0] as [number, number, number], constant: 0 }
const planePayload = [planeEquation]

function findActiveSectionPlaneId(
  nodes: Readonly<Record<string, { type: string } | undefined>>,
): AnyNodeId | null {
  for (const id of sceneRegistry.byType['section-plane'] ?? []) {
    const node = nodes[id] as SectionPlaneNode | undefined
    if (node?.type !== 'section-plane') continue
    if (node.active && node.visible) return id as AnyNodeId
  }
  return null
}

/**
 * Feeds the viewer's scene-wide cut from whichever `section-plane` node is
 * active and visible.
 *
 * The plane is derived from the node's **world matrix**, not from its
 * `position` / `rotation` fields: a section plane parented under a level has to
 * follow that level through stacked / exploded / solo layouts, and only the
 * world matrix carries those offsets. Clipping planes are consumed in world
 * space, so that is also the frame the renderer wants.
 *
 * Runs per frame rather than off a store subscription because dragging the
 * plane writes live transform overrides that never touch `useScene`.
 */
export default function SectionPlaneSystem() {
  // A remount must not leave a stale cut installed on the shared viewer list.
  useEffect(() => clearSceneClippingPlanes, [])

  useFrame(() => {
    const nodes = useScene.getState().nodes
    const activeId = findActiveSectionPlaneId(nodes)
    const object = activeId ? sceneRegistry.nodes.get(activeId) : undefined

    if (!(activeId && object)) {
      if (sceneClippingPlanes.length > 0) clearSceneClippingPlanes()
      return
    }

    const node = nodes[activeId] as SectionPlaneNode
    // The registered group may have moved or been re-parented since the last
    // render, so refresh its world matrix before reading it.
    object.updateWorldMatrix(true, false)

    worldPlane.set(node.flipped ? FLIPPED_NORMAL : REST_NORMAL, 0)
    worldPlane.applyMatrix4(object.matrixWorld)

    planeEquation.normal[0] = worldPlane.normal.x
    planeEquation.normal[1] = worldPlane.normal.y
    planeEquation.normal[2] = worldPlane.normal.z
    planeEquation.constant = worldPlane.constant
    setSceneClippingPlanes(planePayload)
  })

  return null
}
