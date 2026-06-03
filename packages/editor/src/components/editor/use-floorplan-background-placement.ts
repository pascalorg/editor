'use client'

import { emitter, type FenceNode, isCurvedWall, type WallNode } from '@pascal-app/core'
import { type MouseEvent as ReactMouseEvent, useCallback } from 'react'
import { getPlanPointDistance } from '../../lib/floorplan'
import { snapFenceDraftPoint } from '../tools/fence/fence-drafting'
import { WALL_FINE_GRID_STEP, type WallPlanPoint } from '../tools/wall/wall-drafting'

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
  handleCeilingItemPlacementClick: (
    planPoint: WallPlanPoint,
    nativeEvent: ReactMouseEvent<SVGSVGElement>,
  ) => boolean
  handleCeilingPlacementPoint: (point: WallPlanPoint) => void
  handleSlabPlacementPoint: (point: WallPlanPoint) => void
  handleWallPlacementPoint: (point: WallPlanPoint) => void
  handleZonePlacementPoint: (point: WallPlanPoint) => void
  isCeilingBuildActive: boolean
  isCeilingItemPlacementActive: boolean
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
    angleSnap?: boolean
    step?: number
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
  handleCeilingItemPlacementClick,
  handleCeilingPlacementPoint,
  handleSlabPlacementPoint,
  handleWallPlacementPoint,
  handleZonePlacementPoint,
  isCeilingBuildActive,
  isCeilingItemPlacementActive,
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

        if (roofDraftStart) {
          clearRoofPlacementDraft()
        } else {
          setRoofDraftStart(snappedPoint)
          setRoofDraftEnd(snappedPoint)
        }
        return true
      }

      if (isFenceBuildActive) {
        emitFloorplanGridEvent('click', planPoint, event)

        // Fence draft: grid snap only; Shift = fine step. See `wall/tool.tsx`.
        const snappedPoint = snapFenceDraftPoint({
          point: planPoint,
          walls,
          fences,
          step: shiftPressed ? WALL_FINE_GRID_STEP : undefined,
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

      // Slab / zone polygon build — local draft state + grid emit.
      // Must run BEFORE the `isFloorplanGridInteractionActive` catch-all
      // (since slab is registry-driven, the catch-all would otherwise
      // swallow the click and skip local draft state updates — leaving
      // the 2D draft polygon invisible while the 3D tool builds fine).
      if (isPolygonBuildActive) {
        const snappedPoint = snapPolygonDraftPoint({
          point: planPoint,
          start: activePolygonDraftPoints[activePolygonDraftPoints.length - 1],
          angleSnap: activePolygonDraftPoints.length > 0 && !shiftPressed,
        })

        // Emit the grid event so the registry-driven slab tool also
        // sees the click (parity with ceiling / fence / roof branches
        // above). Zone has no registry tool — emit-or-not is irrelevant.
        if (!isZoneBuildActive) {
          emitFloorplanGridEvent('click', snappedPoint, event)
        }

        if (isZoneBuildActive) {
          handleZonePlacementPoint(snappedPoint)
        } else {
          handleSlabPlacementPoint(snappedPoint)
        }
        return true
      }

      // Wall placement — local draft state + grid emit. Same reasoning
      // as slab above: wall is registry-driven, so without this branch
      // the catch-all would swallow the click and the local draftStart
      // / draftEnd state in the floor plan would never update, leaving
      // the dashed-line draft preview invisible.
      if (isWallBuildActive) {
        // Wall draft: grid snap only; Shift = fine step. See `wall/tool.tsx`.
        const snappedPoint = snapWallDraftPoint({
          point: planPoint,
          walls,
          step: shiftPressed ? WALL_FINE_GRID_STEP : undefined,
        })

        emitFloorplanGridEvent('click', snappedPoint, event)
        handleWallPlacementPoint(snappedPoint)
        return true
      }

      // Ceiling-attached item placement (lights, fans). Routes the click
      // through `ceiling:click` instead of `grid:click` so the placement
      // strategy parents the new item to the ceiling at the correct
      // height — mirrors the pointer-move handler in `floorplan-panel`.
      if (isCeilingItemPlacementActive) {
        handleCeilingItemPlacementClick(planPoint, event)
        return true
      }

      // Generic catch-all — registry-driven tool whose kind has no
      // local floor-plan draft handler (column / spawn / shelf / etc.).
      // The tool's `grid:click` subscriber owns the placement.
      if (isFloorplanGridInteractionActive) {
        const snappedPoint = emitFloorplanGridEvent('click', planPoint, event)
        setCursorPoint(snappedPoint)
        return true
      }

      return false
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
      handleCeilingItemPlacementClick,
      handleCeilingPlacementPoint,
      handleSlabPlacementPoint,
      handleZonePlacementPoint,
      isCeilingBuildActive,
      isCeilingItemPlacementActive,
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
