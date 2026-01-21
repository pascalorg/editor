import { useCallback } from 'react'
import type { LevelNode, WallNode } from '../../schema'
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
      ignoreIds?: string[],
    ) => {
      return spatialGridManager.canPlaceOnWall(
        levelId,
        wallId,
        localX,
        localY,
        dimensions,
        ignoreIds,
      )
    },
    [],
  )

  return { canPlaceOnFloor, canPlaceOnWall }
}
