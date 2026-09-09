'use client'

import { type AnyNodeId, useLiveNodeOverrides, useScene, type WallNode } from '@pascal-app/core'
import { timeSpan, WallCutout, WallSystem } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import {
  buildWallTreatmentLevelData,
  clearWallTreatmentMiterCache,
  sameTreatmentWalls,
  treatmentProudKeys,
  useWallTreatmentLevelData,
} from './treatment-level-data'
import { wallTreatmentProudOffsets } from './treatments'
import { WallBatchSystem } from './wall-batch-system'

const levelInputs = new Map<string, { walls: readonly WallNode[]; proudKey: string }>()
let effectiveWalls = new WeakMap<
  WallNode,
  { override: ReturnType<ReturnType<typeof useLiveNodeOverrides.getState>['get']>; wall: WallNode }
>()
let previousNodes: ReturnType<typeof useScene.getState>['nodes'] | undefined
let previousOverrides: ReturnType<typeof useLiveNodeOverrides.getState>['overrides'] | undefined

function effectiveWall(wall: WallNode): WallNode {
  const override = useLiveNodeOverrides.getState().get(wall.id)
  if (!override) return wall
  const cached = effectiveWalls.get(wall)
  if (cached?.override === override) return cached.wall
  const effective = { ...wall, ...override } as WallNode
  effectiveWalls.set(wall, { override, wall: effective })
  return effective
}

export function resetWallTreatmentLevels(): void {
  levelInputs.clear()
  effectiveWalls = new WeakMap()
  previousNodes = undefined
  previousOverrides = undefined
  clearWallTreatmentMiterCache()
  useWallTreatmentLevelData.setState({ byLevelId: new Map() })
}

export function updateWallTreatmentLevels(): void {
  const { dirtyNodes, nodes } = useScene.getState()
  const { overrides } = useLiveNodeOverrides.getState()
  const dirtyLevelIds = new Set<string>()
  for (const id of dirtyNodes) {
    const node = nodes[id]
    if (node?.type === 'wall' && node.parentId) dirtyLevelIds.add(node.parentId)
    else if (node?.type === 'level') dirtyLevelIds.add(node.id)
  }

  // Removed walls and cleared overrides can leave no dirty wall to identify their old level.
  if (nodes !== previousNodes || overrides !== previousOverrides) {
    for (const levelId of levelInputs.keys()) dirtyLevelIds.add(levelId)
    previousNodes = nodes
    previousOverrides = overrides
  }

  for (const levelId of dirtyLevelIds) {
    const level = nodes[levelId as AnyNodeId]
    if (level?.type !== 'level') {
      levelInputs.delete(levelId)
      clearWallTreatmentMiterCache(levelId)
      useWallTreatmentLevelData.getState().removeLevelData(levelId)
      continue
    }
    const walls = level.children
      .map((id) => nodes[id])
      .filter((node): node is WallNode => node?.type === 'wall')
      .map(effectiveWall)
    const proudOffsets = walls.flatMap(wallTreatmentProudOffsets)
    const proudKey = treatmentProudKeys(proudOffsets).join(',')
    const previous = levelInputs.get(levelId)
    if (previous?.proudKey === proudKey && sameTreatmentWalls(previous.walls, walls)) continue

    timeSpan('wall-treatment-level', () => {
      useWallTreatmentLevelData
        .getState()
        .setLevelData(levelId, buildWallTreatmentLevelData(levelId, walls, proudOffsets))
      levelInputs.set(levelId, { walls, proudKey })
    })
  }
}

const WallTreatmentMiterSystem = () => {
  useEffect(() => resetWallTreatmentLevels, [])
  useFrame(updateWallTreatmentLevels, -1)

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
 *  - **`WallBatchSystem`** — once a level stops changing, sews its opaque
 *    walls into one mesh per material set so a floor costs a handful of
 *    draw calls instead of one per wall face run.
 */
const WallSystems = () => {
  return (
    <>
      <WallTreatmentMiterSystem />
      <WallSystem />
      <WallCutout />
      <WallBatchSystem />
    </>
  )
}

export default WallSystems
