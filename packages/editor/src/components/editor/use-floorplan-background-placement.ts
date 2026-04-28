'use client'

import { emitter, type FenceNode, isCurvedWall, type WallNode } from '@pascal-app/core'
import { type MouseEvent as ReactMouseEvent, useCallback } from 'react'
import { getPlanPointDistance } from '../../lib/floorplan'
import { snapFenceDraftPoint } from '../tools/fence/fence-drafting'
import type { WallPlanPoint } from '../tools/wall/wall-drafting'

type UseFloorplanBackgroundPlacementArgs = {
  activePolygonDraftPoints: WallPlanPoint[]
  ceilingDraftPoints: WallPlanPoint[]
  clearFencePlacementDraft: () => void
  clearRoofPlacementDraft: () => void
  emitFloorplanGridEvent: (
    type: 'click' | 'double-click' | 'move',
    planPoint: WallPlanPoint,
    event: ReactMouseEvent<SVGSVGElement>,
  ) => WallPlanPoint
  fenceDraftStart: WallPlanPoint | null
  fences: FenceNode[]
  findClosestWallPoint: (
    point: WallPlanPoint,
    walls: WallNode[],
    options?: { canUseWall?: (wall: WallNode) => boolean },
  ) => {
    normal: [number, number, number]
    point: WallPlanPoint
    t: number
    wall: WallNode
  } | null
  floorplanOpeningLocalY: number
  getSnappedFloorplanPoint: (point: WallPlanPoint) => WallPlanPoint
  handleCeilingPlacementPoint: (point: WallPlanPoint) => void
  handleSlabPlacementPoint: (point: WallPlanPoint) => void
  handleWallPlacementPoint: (point: WallPlanPoint) => void
  handleZonePlacementPoint: (point: WallPlanPoint) => void
  isCeilingBuildActive: boolean
  isFenceBuildActive: boolean
  isFloorplanGridInteractionActive: boolean
  isOpeningPlacementActive: boolean
  isPolygonBuildActive: boolean
  isRoofBuildActive: boolean
  isWallBuildActive: boolean
  isZoneBuildActive: boolean
  roofDraftStart: WallPlanPoint | null
  setCursorPoint: React.Dispatch<React.SetStateAction<WallPlanPoint | null>>
  setFenceDraftEnd: React.Dispatch<React.SetStateAction<WallPlanPoint | null>>
  setFenceDraftStart: React.Dispatch<React.SetStateAction<WallPlanPoint | null>>
  setRoofDraftEnd: React.Dispatch<React.SetStateAction<WallPlanPoint | null>>
  setRoofDraftStart: React.Dispatch<React.SetStateAction<WallPlanPoint | null>>
  shiftPressed: boolean
  snapWallDraftPoint: (args: {
    point: WallPlanPoint
    walls: WallNode[]
    start?: WallPlanPoint
    angleSnap: boolean
  }) => WallPlanPoint
  snapPolygonDraftPoint: (args: {
    point: WallPlanPoint
    start?: WallPlanPoint
    angleSnap: boolean
  }) => WallPlanPoint
  toPoint2D: (point: WallPlanPoint) => { x: number; y: number }
  walls: WallNode[]
}

export function useFloorplanBackgroundPlacement({
  activePolygonDraftPoints,
  ceilingDraftPoints,
  clearFencePlacementDraft,
  clearRoofPlacementDraft,
  emitFloorplanGridEvent,
  fenceDraftStart,
  fences,
  findClosestWallPoint,
  floorplanOpeningLocalY,
  getSnappedFloorplanPoint,
  handleCeilingPlacementPoint,
  handleSlabPlacementPoint,
  handleWallPlacementPoint,
  handleZonePlacementPoint,
  isCeilingBuildActive,
  isFenceBuildActive,
  isFloorplanGridInteractionActive,
  isOpeningPlacementActive,
  isPolygonBuildActive,
  isRoofBuildActive,
  isWallBuildActive,
  isZoneBuildActive,
  roofDraftStart,
  setCursorPoint,
  setFenceDraftEnd,
  setFenceDraftStart,
  setRoofDraftEnd,
  setRoofDraftStart,
  shiftPressed,
  snapWallDraftPoint,
  snapPolygonDraftPoint,
  toPoint2D,
  walls,
}: UseFloorplanBackgroundPlacementArgs) {
  const handleBackgroundPlacementClick = useCallback(
    (
      planPoint: WallPlanPoint,
      event: ReactMouseEvent<SVGSVGElement>,
      draftStart: WallPlanPoint | null,
    ) => {
      if (isOpeningPlacementActive) {
        const closest = findClosestWallPoint(planPoint, walls, {
          canUseWall: (wall) => !isCurvedWall(wall),
        })
        if (closest) {
          const dx = closest.wall.end[0] - closest.wall.start[0]
          const dz = closest.wall.end[1] - closest.wall.start[1]
          const length = Math.sqrt(dx * dx + dz * dz)
          const distance = closest.t * length

          emitter.emit('wall:click', {
            node: closest.wall,
            point: { x: closest.point[0], y: 0, z: closest.point[1] },
            localPosition: [distance, floorplanOpeningLocalY, 0],
            normal: closest.normal,
            stopPropagation: () => {},
          } as any)
        }
        return true
      }

      if (isCeilingBuildActive) {
        emitFloorplanGridEvent('click', planPoint, event)

        const snappedPoint = snapPolygonDraftPoint({
          point: planPoint,
          start: ceilingDraftPoints[ceilingDraftPoints.length - 1],
          angleSnap: ceilingDraftPoints.length > 0 && !shiftPressed,
        })

        handleCeilingPlacementPoint(snappedPoint)
        return true
      }

      if (isRoofBuildActive) {
        const snappedPoint = getSnappedFloorplanPoint(planPoint)
        emitFloorplanGridEvent('click', snappedPoint, event)
        setCursorPoint(snappedPoint)

        if (!roofDraftStart) {
          setRoofDraftStart(snappedPoint)
          setRoofDraftEnd(snappedPoint)
        } else {
          clearRoofPlacementDraft()
        }
        return true
      }

      if (isFenceBuildActive) {
        emitFloorplanGridEvent('click', planPoint, event)

        const snappedPoint = snapFenceDraftPoint({
          point: planPoint,
          walls,
          fences,
          start: fenceDraftStart ?? undefined,
          angleSnap: Boolean(fenceDraftStart) && !shiftPressed,
        })

        setCursorPoint(snappedPoint)

        if (!fenceDraftStart) {
          setFenceDraftStart(snappedPoint)
          setFenceDraftEnd(snappedPoint)
        } else if (
          getPlanPointDistance(toPoint2D(fenceDraftStart), toPoint2D(snappedPoint)) >= 0.01
        ) {
          clearFencePlacementDraft()
        } else {
          setFenceDraftEnd(snappedPoint)
        }
        return true
      }

      if (isFloorplanGridInteractionActive) {
        const snappedPoint = emitFloorplanGridEvent('click', planPoint, event)
        setCursorPoint(snappedPoint)
        return true
      }

      if (isPolygonBuildActive) {
        const snappedPoint = snapPolygonDraftPoint({
          point: planPoint,
          start: activePolygonDraftPoints[activePolygonDraftPoints.length - 1],
          angleSnap: activePolygonDraftPoints.length > 0 && !shiftPressed,
        })

        if (isZoneBuildActive) {
          handleZonePlacementPoint(snappedPoint)
        } else {
          handleSlabPlacementPoint(snappedPoint)
        }
        return true
      }

      if (!isWallBuildActive) {
        return false
      }

      const snappedPoint = snapWallDraftPoint({
        point: planPoint,
        walls,
        start: draftStart ?? undefined,
        angleSnap: Boolean(draftStart) && !shiftPressed,
      })

      handleWallPlacementPoint(snappedPoint)
      return true
    },
    [
      activePolygonDraftPoints,
      ceilingDraftPoints,
      clearFencePlacementDraft,
      clearRoofPlacementDraft,
      emitFloorplanGridEvent,
      fenceDraftStart,
      fences,
      findClosestWallPoint,
      floorplanOpeningLocalY,
      getSnappedFloorplanPoint,
      handleCeilingPlacementPoint,
      handleSlabPlacementPoint,
      handleZonePlacementPoint,
      isCeilingBuildActive,
      isFenceBuildActive,
      isFloorplanGridInteractionActive,
      isOpeningPlacementActive,
      isPolygonBuildActive,
      isRoofBuildActive,
      isWallBuildActive,
      isZoneBuildActive,
      roofDraftStart,
      setCursorPoint,
      setFenceDraftEnd,
      setFenceDraftStart,
      setRoofDraftEnd,
      setRoofDraftStart,
      shiftPressed,
      snapWallDraftPoint,
      snapPolygonDraftPoint,
      toPoint2D,
      walls,
      handleWallPlacementPoint,
    ],
  )

  return {
    handleBackgroundPlacementClick,
  }
}
