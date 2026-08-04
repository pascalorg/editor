'use client'

import { type AnyNodeId, useLiveNodeOverrides, useScene, type WallNode } from '@pascal-app/core'
import { WallCutout, WallSystem } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { buildWallTreatmentLevelData, useWallTreatmentLevelData } from './treatment-level-data'
import { wallTreatmentProudOffsets } from './treatments'

function effectiveWall(wall: WallNode): WallNode {
  const override = useLiveNodeOverrides.getState().get(wall.id)
  return override ? ({ ...wall, ...override } as WallNode) : wall
}

const WallTreatmentMiterSystem = () => {
  useFrame(() => {
    const { dirtyNodes, nodes } = useScene.getState()
    if (dirtyNodes.size === 0) return

    const dirtyLevelIds = new Set<string>()
    for (const id of dirtyNodes) {
      const node = nodes[id]
      if (node?.type === 'wall' && node.parentId) dirtyLevelIds.add(node.parentId)
    }

    for (const levelId of dirtyLevelIds) {
      const level = nodes[levelId as AnyNodeId]
      if (level?.type !== 'level') continue
      const walls = level.children
        .map((id) => nodes[id])
        .filter((node): node is WallNode => node?.type === 'wall')
        .map(effectiveWall)
      const proudOffsets = walls.flatMap(wallTreatmentProudOffsets)
      useWallTreatmentLevelData
        .getState()
        .setLevelData(levelId, buildWallTreatmentLevelData(walls, proudOffsets))
    }
  }, -1)

  return null
}

/**
 * Registry-driven wall system bundle.
 *
 *  - **`WallSystem`** — reads `dirtyNodes`, batches by level, runs
 *    `calculateLevelMiters(levelWalls)`, rebuilds geometry via
 *    `generateExtrudedWall(node, children, miterData, slabElevation, baseElevation, baseSegments, storeyHeight)`,
 *    and cascades to adjacent walls that share a junction. This is the
 *    bulk of the wall runtime (~820 lines in viewer).
 *  - **`WallCutout`** — cutaway-mode hide/show logic based on camera
 *    direction and `frontSide` / `backSide` interior/exterior tags.
 */
const WallSystems = () => {
  return (
    <>
      <WallTreatmentMiterSystem />
      <WallSystem />
      <WallCutout />
    </>
  )
}

export default WallSystems
