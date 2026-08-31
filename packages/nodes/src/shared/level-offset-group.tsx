'use client'

import { type AnyNodeId, sceneRegistry } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { type ReactNode, useRef } from 'react'
import type { Group } from 'three'

/**
 * Wraps a placement tool's preview/ghost so it rides the active level's
 * stacked elevation.
 *
 * Placement tools are mounted inside the building-local group (see the editor's
 * ToolManager), which carries no per-floor elevation. But their points, ports,
 * and committed paths are level-local (Y=0 = the floor) and the committed nodes
 * parent to the level mesh, which DOES carry the stacked Y offset. Without this
 * the ghost renders at world ground on upper floors while the cursor raycast
 * rides the floor plane — they drift apart. Tracking the level mesh's Y here
 * (the same value the grid plane follows) keeps the preview on the floor being
 * drawn, with no change to any tool's level-local math.
 */
export function LevelOffsetGroup({ children }: { children: ReactNode }) {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const ref = useRef<Group>(null)

  useFrame(() => {
    const group = ref.current
    if (!group) return
    const levelMesh = activeLevelId ? sceneRegistry.nodes.get(activeLevelId as AnyNodeId) : null
    group.position.y = levelMesh ? levelMesh.position.y : 0
  })

  return <group ref={ref}>{children}</group>
}
