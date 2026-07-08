'use client'

import { emitter, type FenceNode, isCurvedWall, type WallNode } from '@pascal-app/core'
import { type MouseEvent as ReactMouseEvent, useCallback } from 'react'
import { resolveCeilingPlanPointSnap } from '../../lib/ceiling-plan-snap'
import { alignFloorplanDraftPoint, getPlanPointDistance } from '../../lib/floorplan'
import { resolveSlabPlanPointSnap } from '../../lib/slab-plan-snap'
import useAlignmentGuides from '../../store/use-alignment-guides'
import useEditor, { isAngleSnapActive, isMagneticSnapActive } from '../../store/use-editor'
import usePlacementPreview from '../../store/use-placement-preview'
import useSegmentDraftChain from '../../store/use-segment-draft-chain'
import { snapFenceDraftPoint } from '../tools/fence/fence-drafting'
import { getSegmentGridStep, type WallPlanPoint } from '../tools/wall/wall-drafting'

type UseFloorplanBackgroundPlacementArgs = {
  activePolygonDraftPoints: WallPlanPoint[]
  ceilingDraftPoints: WallPlanPoint[]
  clearFencePlacementDraft: () => void
  clearRoofPlacementDraft: () => void
  clearWallPlacementDraft: () => void
  emitFloorplanGridEvent: (
    type: 'click' | 'double-click' | 'move',
    planPoint: WallPlanPoint,
    event: ReactMouseEvent<SVGSVGElement>,
  ) => void
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
  isSlabBuildActive: boolean
  isWallBuildActive: boolean
  isZoneBuildActive: boolean
  levelId: string | null
  roofDraftStart: WallPlanPoint | null
  setCursorPoint: React.Dispatch<React.SetStateAction<WallPlanPoint | null>>
  setFenceDraftEnd: React.Dispatch<React.SetStateAction<WallPlanPoint | null>>
  setFenceDraftStart: React.Dispatch<React.SetStateAction<WallPlanPoint | null>>
  setRoofDraftEnd: React.Dispatch<React.SetStateAction<WallPlanPoint | null>>
  setRoofDraftStart: React.Dispatch<React.SetStateAction<WallPlanPoint | null>>
  snapWallDraftPoint: (args: {
    point: WallPlanPoint
    walls: WallNode[]
    start?: WallPlanPoint
    angleSnap?: boolean
    bypassSnap?: boolean
    step?: number
    gridSnap?: (point: WallPlanPoint) => WallPlanPoint
  }) => WallPlanPoint
  snapPolygonDraftPoint: (args: {
    point: WallPlanPoint
    start?: WallPlanPoint
    angleSnap: boolean
  }) => WallPlanPoint
  toPoint2D: (point: WallPlanPoint) => { x: number; y: number }
  walls: WallNode[]
  /**
   * Snap a building-local plan point to the world XZ grid at `step`.
   * Injected so the hook doesn't have to know the building's rotation
   * or position — used by wall / fence branches that snap at variable
   * step.
   */
  worldGridSnap: (point: WallPlanPoint, step: number) => WallPlanPoint
}

export function useFloorplanBackgroundPlacement({
  activePolygonDraftPoints,
  ceilingDraftPoints,
  clearFencePlacementDraft,
  clearRoofPlacementDraft,
  clearWallPlacementDraft,
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
  isSlabBuildActive,
  isWallBuildActive,
  isZoneBuildActive,
  levelId,
  roofDraftStart,
  setCursorPoint,
  setFenceDraftEnd,
  setFenceDraftStart,
  setRoofDraftEnd,
  setRoofDraftStart,
  snapWallDraftPoint,
  snapPolygonDraftPoint,
  toPoint2D,
  walls,
  worldGridSnap,
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
        // Drop the off-wall ghost on commit so it doesn't linger at the
        // just-placed spot before the next pointer move re-evaluates.
        usePlacementPreview.getState().clear()
        return true
      }

      if (isCeilingBuildActive) {
        // Align the committed vertex the same way the move-preview did, so the
        // placed point matches what the user saw — mode-driven (the chip):
        // `grid` quantizes, `angles` locks 15° rays, `lines` snaps onto walls /
        // alignment, `off` is free. Alt forces (skips alignment).
        const angleSnap = ceilingDraftPoints.length > 0 && isAngleSnapActive()
        const fallbackPoint = snapPolygonDraftPoint({
          point: planPoint,
          start: ceilingDraftPoints[ceilingDraftPoints.length - 1],
          angleSnap,
        })
        const snappedPoint = resolveCeilingPlanPointSnap({
          rawPoint: planPoint,
          fallbackPoint,
          levelId,
          altKey: event.altKey,
          align: !angleSnap,
        }).point

        emitFloorplanGridEvent('click', snappedPoint, event)
        handleCeilingPlacementPoint(snappedPoint)
        return true
      }

      if (isRoofBuildActive) {
        // Footprint placement (polygon context: grid / lines / off, no angle),
        // mode-driven to match the chip. Alt forces (skips alignment).
        const snappedPoint = alignFloorplanDraftPoint(getSnappedFloorplanPoint(planPoint), {
          applySnap: isMagneticSnapActive(),
          bypass: event.altKey,
        })
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
        // Fence draft: mode-driven (matches the chip), same as the move
        // preview. `grid` snaps to the world XZ grid (rotation-safe via the
        // `gridSnap` callback), `angles` locks 15° rays from the start, `lines`
        // pulls onto walls / fences / alignment, `off` is free.
        const fenceStep = getSegmentGridStep()
        const fenceAngleSnap = fenceDraftStart !== null && isAngleSnapActive()
        const fenceSnapped = snapFenceDraftPoint({
          point: planPoint,
          walls,
          fences,
          start: fenceDraftStart ?? undefined,
          angleSnap: fenceAngleSnap,
          magnetic: isMagneticSnapActive(),
          gridSnap: (p) => worldGridSnap(p, fenceStep),
        })
        const fenceGridBase = worldGridSnap(planPoint, fenceStep)
        const fenceLocked =
          fenceSnapped[0] !== fenceGridBase[0] || fenceSnapped[1] !== fenceGridBase[1]
        const snappedPoint = fenceLocked
          ? fenceSnapped
          : alignFloorplanDraftPoint(fenceSnapped, {
              applySnap: isMagneticSnapActive() && !fenceAngleSnap,
            })

        emitFloorplanGridEvent('click', snappedPoint, event)
        setCursorPoint(snappedPoint)

        // Double-click finishes the chain. The emit above already made the
        // 3D fence tool stopDrafting (its detail >= 2 guard), so close the
        // 2D draft too — leaving it open desyncs the two views.
        if (fenceDraftStart && event.detail >= 2) {
          clearFencePlacementDraft()
          return true
        }

        if (!fenceDraftStart) {
          setFenceDraftStart(snappedPoint)
          setFenceDraftEnd(snappedPoint)
        } else if (
          getPlanPointDistance(toPoint2D(fenceDraftStart), toPoint2D(snappedPoint)) >= 0.01
        ) {
          // Single mode commits one segment per click: the same emit above
          // already made the 3D fence tool stopDrafting, so close the 2D
          // draft too instead of chaining.
          if (useEditor.getState().getContinuation('fence') === 'single') {
            clearFencePlacementDraft()
            setCursorPoint(snappedPoint)
            return true
          }
          // The 3D fence tool owns creation and keeps chaining from the
          // committed fence's resolved end — chain the 2D draft from the
          // same published point so both views draft the next segment
          // from the same start.
          const nextStart = useSegmentDraftChain.getState().fence ?? snappedPoint
          setFenceDraftStart(nextStart)
          setFenceDraftEnd(nextStart)
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
        const angleSnap = activePolygonDraftPoints.length > 0 && isAngleSnapActive()
        const fallbackPoint = snapPolygonDraftPoint({
          point: planPoint,
          start: activePolygonDraftPoints[activePolygonDraftPoints.length - 1],
          angleSnap,
        })
        // Zone shares the slab surface snap (wall corners / midpoints /
        // crossings + alignment) — it's the same polygon-on-a-level draw.
        const snappedPoint = resolveSlabPlanPointSnap({
          rawPoint: planPoint,
          fallbackPoint,
          levelId,
          altKey: event.altKey,
          align: !angleSnap,
        }).point

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
        // Wall draft: mode-driven (matches the chip + the move-preview branch).
        // `grid` snaps to the world XZ grid (rotation-safe via `gridSnap`),
        // `angles` locks 15° rays from the start, `lines` pulls the endpoint
        // onto existing wall corners / edges + alignment, `off` is free.
        const wallStep = getSegmentGridStep()
        const wallAngleSnap = draftStart !== null && isAngleSnapActive()
        const wallSnapped = snapWallDraftPoint({
          point: planPoint,
          walls,
          start: draftStart ?? undefined,
          angleSnap: wallAngleSnap,
          gridSnap: (p) => worldGridSnap(p, wallStep),
        })
        const wallGridBase = worldGridSnap(planPoint, wallStep)
        const wallLocked = wallSnapped[0] !== wallGridBase[0] || wallSnapped[1] !== wallGridBase[1]
        let snappedPoint = wallSnapped
        if (wallLocked) {
          useAlignmentGuides.getState().clear()
        } else {
          // Alignment lines are shown in every mode; the pull applies only when
          // magnetic ('lines') and the segment isn't angle-locked.
          snappedPoint = alignFloorplanDraftPoint(wallSnapped, {
            applySnap: isMagneticSnapActive() && !wallAngleSnap,
          })
        }

        emitFloorplanGridEvent('click', snappedPoint, event)

        // Double-click finishes the chain. The emit above already made the
        // 3D wall tool stopDrafting (its detail >= 2 guard), so close the
        // 2D draft too — otherwise it stays open against a closed 3D tool
        // and the next previewed segment is silently never created.
        if (draftStart && event.detail >= 2) {
          clearWallPlacementDraft()
          setCursorPoint(snappedPoint)
          return true
        }

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
        const snappedPoint = event.shiftKey ? planPoint : getSnappedFloorplanPoint(planPoint)
        emitFloorplanGridEvent('click', snappedPoint, event)
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
      clearWallPlacementDraft,
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
      isSlabBuildActive,
      isWallBuildActive,
      isZoneBuildActive,
      levelId,
      roofDraftStart,
      setCursorPoint,
      setFenceDraftEnd,
      setFenceDraftStart,
      setRoofDraftEnd,
      setRoofDraftStart,
      snapWallDraftPoint,
      snapPolygonDraftPoint,
      toPoint2D,
      walls,
      handleWallPlacementPoint,
      worldGridSnap,
    ],
  )

  return {
    handleBackgroundPlacementClick,
  }
}
