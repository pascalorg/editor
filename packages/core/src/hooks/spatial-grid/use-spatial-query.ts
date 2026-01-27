import { useCallback } from 'react'
import type { CeilingNode, LevelNode, WallNode } from '../../schema'
import { spatialGridManager } from './spatial-grid-manager'

export function useSpatialQuery() {
  const canPlaceOnFloor = useCallback(
    (
      levelId: LevelNode['id'],
      position: [number, number, number],
      dimensions: [number, number, number],
      rotation: [number, number, number],
      ignoreIds?: string[],
    ) => {
      return spatialGridManager.canPlaceOnFloor(levelId, position, dimensions, rotation, ignoreIds)
    },
    [],
  )

  const canPlaceOnWall = useCallback(
    (
      levelId: LevelNode['id'],
      wallId: WallNode['id'],
      localX: number,
      localY: number,
      dimensions: [number, number, number],
      attachType: 'wall' | 'wall-side' = 'wall',
      side?: 'front' | 'back',
      ignoreIds?: string[],
    ) => {
      return spatialGridManager.canPlaceOnWall(
        levelId,
        wallId,
        localX,
        localY,
        dimensions,
        attachType,
        side,
        ignoreIds,
      )
    },
    [],
  )

  const canPlaceOnCeiling = useCallback(
    (
      ceilingId: CeilingNode['id'],
      position: [number, number, number],
      dimensions: [number, number, number],
      rotation: [number, number, number],
      ignoreIds?: string[],
    ) => {
      return spatialGridManager.canPlaceOnCeiling(ceilingId, position, dimensions, rotation, ignoreIds)
    },
    [],
  )

  return { canPlaceOnFloor, canPlaceOnWall, canPlaceOnCeiling }
}
