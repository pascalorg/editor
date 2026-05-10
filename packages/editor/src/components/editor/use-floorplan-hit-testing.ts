'use client'

import type {
  AnyNode,
  CeilingNode,
  ColumnNode,
  DoorNode,
  ElevatorNode,
  ItemNode,
  Point2D,
  RoofNode,
  RoofSegmentNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { useCallback } from 'react'
import {
  getFloorplanHitNodeId,
  getFloorplanSelectionIdsInBounds,
} from '../../lib/floorplan/selection-tool'
import type { FloorplanSelectionBounds } from '../../lib/floorplan/types'
import type { WallPlanPoint } from '../tools/wall/wall-drafting'

type OpeningNode = WindowNode | DoorNode

type WallPolygonEntry = {
  wall: WallNode
  polygon: Point2D[]
}

type OpeningPolygonEntry = {
  opening: OpeningNode
  polygon: Point2D[]
}

type SlabPolygonEntry = {
  slab: SlabNode
  polygon: Point2D[]
  holes: Point2D[][]
}

type CeilingPolygonEntry = {
  ceiling: CeilingNode
  polygon: Point2D[]
  holes: Point2D[][]
}

type ColumnPolygonEntry = {
  column: ColumnNode
  polygon: Point2D[]
}

type ElevatorPolygonEntry = {
  elevator: ElevatorNode
  polygon: Point2D[]
}

type FloorplanRoofEntry = {
  roof: RoofNode
  segments: Array<{
    polygon: Point2D[]
    segment: RoofSegmentNode
  }>
}

type FloorplanItemEntry = {
  item: ItemNode
  polygon: Point2D[]
}

type FloorplanStairSegmentEntry = {
  polygon: Point2D[]
  segment: StairSegmentNode | AnyNode
}

type FloorplanStairEntry = {
  hitPolygons: Point2D[][]
  stair: StairNode
  segments: FloorplanStairSegmentEntry[]
}

type UseFloorplanHitTestingArgs = {
  ceilingPolygons: CeilingPolygonEntry[]
  columnPolygons: ColumnPolygonEntry[]
  displaySlabPolygons: SlabPolygonEntry[]
  displayWallPolygons: WallPolygonEntry[]
  floorplanElevatorEntries: ElevatorPolygonEntry[]
  floorplanItemEntries: FloorplanItemEntry[]
  floorplanOpeningHitTolerance: number
  floorplanRoofEntries: FloorplanRoofEntry[]
  floorplanStairEntries: FloorplanStairEntry[]
  floorplanWallHitTolerance: number
  getOpeningCenterLine: (polygon: Point2D[]) => { start: Point2D; end: Point2D } | null
  isFloorplanItemContextActive: boolean
  openingsPolygons: OpeningPolygonEntry[]
  phase: 'site' | 'structure' | 'furnish'
  toPoint2D: (point: WallPlanPoint) => Point2D
}

export function useFloorplanHitTesting({
  ceilingPolygons,
  columnPolygons,
  displaySlabPolygons,
  displayWallPolygons,
  floorplanElevatorEntries,
  floorplanItemEntries,
  floorplanOpeningHitTolerance,
  floorplanRoofEntries,
  floorplanStairEntries,
  floorplanWallHitTolerance,
  getOpeningCenterLine,
  isFloorplanItemContextActive,
  openingsPolygons,
  phase,
  toPoint2D,
}: UseFloorplanHitTestingArgs) {
  const getFloorplanHitIdAtPoint = useCallback(
    (planPoint: WallPlanPoint) => {
      const point = toPoint2D(planPoint)
      return getFloorplanHitNodeId({
        point,
        ceilings: ceilingPolygons,
        phase,
        isItemContextActive: isFloorplanItemContextActive,
        items: floorplanItemEntries,
        openings: openingsPolygons,
        roofs: floorplanRoofEntries,
        stairs: floorplanStairEntries,
        elevators: floorplanElevatorEntries,
        walls: displayWallPolygons,
        slabs: displaySlabPolygons,
        openingHitTolerance: floorplanOpeningHitTolerance,
        wallHitTolerance: floorplanWallHitTolerance,
        columns: columnPolygons,
        getOpeningCenterLine,
      })
    },
    [
      ceilingPolygons,
      columnPolygons,
      displaySlabPolygons,
      displayWallPolygons,
      floorplanItemEntries,
      floorplanElevatorEntries,
      floorplanOpeningHitTolerance,
      floorplanRoofEntries,
      floorplanStairEntries,
      floorplanWallHitTolerance,
      getOpeningCenterLine,
      isFloorplanItemContextActive,
      openingsPolygons,
      phase,
      toPoint2D,
    ],
  )

  const getFloorplanSelectionIdsInBoundsForArea = useCallback(
    (bounds: FloorplanSelectionBounds) =>
      getFloorplanSelectionIdsInBounds({
        bounds,
        ceilings: ceilingPolygons,
        phase,
        isItemContextActive: isFloorplanItemContextActive,
        items: floorplanItemEntries,
        walls: displayWallPolygons,
        openings: openingsPolygons,
        roofs: floorplanRoofEntries,
        slabs: displaySlabPolygons,
        columns: columnPolygons,
        elevators: floorplanElevatorEntries,
        stairs: floorplanStairEntries,
      }),
    [
      ceilingPolygons,
      columnPolygons,
      displaySlabPolygons,
      displayWallPolygons,
      floorplanItemEntries,
      floorplanElevatorEntries,
      floorplanRoofEntries,
      floorplanStairEntries,
      isFloorplanItemContextActive,
      openingsPolygons,
      phase,
    ],
  )

  return {
    getFloorplanHitIdAtPoint,
    getFloorplanSelectionIdsInBounds: getFloorplanSelectionIdsInBoundsForArea,
  }
}
