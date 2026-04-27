import type {
  CeilingNode,
  DoorNode,
  ItemNode,
  Point2D,
  RoofNode,
  RoofSegmentNode,
  SlabNode,
  StairNode,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import {
  doesPolygonIntersectSelectionBounds,
  getDistanceToWallSegment,
  isPointInsidePolygon,
  isPointInsidePolygonWithHoles,
} from './geometry'
import type { FloorplanSelectionBounds } from './types'

type OpeningNode = WindowNode | DoorNode

type OpeningPolygonEntry = {
  opening: OpeningNode
  polygon: Point2D[]
}

type ItemEntry = {
  item: ItemNode
  polygon: Point2D[]
}

type StairEntry = {
  hitPolygons: Point2D[][]
  stair: StairNode
  segments: Array<{ polygon: Point2D[] }>
}

type WallEntry = {
  wall: WallNode
  polygon: Point2D[]
}

type SlabEntry = {
  slab: SlabNode
  polygon: Point2D[]
  holes: Point2D[][]
}

type CeilingEntry = {
  ceiling: CeilingNode
  polygon: Point2D[]
  holes: Point2D[][]
}

type RoofEntry = {
  roof: RoofNode
  segments: Array<{
    polygon: Point2D[]
    segment: RoofSegmentNode
  }>
}

type FloorplanSelectionToolContext = {
  point: Point2D
  phase: 'site' | 'structure' | 'furnish'
  isItemContextActive: boolean
  items: ItemEntry[]
  openings: OpeningPolygonEntry[]
  stairs: StairEntry[]
  walls: WallEntry[]
  slabs: SlabEntry[]
  ceilings: CeilingEntry[]
  roofs: RoofEntry[]
  openingHitTolerance: number
  wallHitTolerance: number
  getOpeningCenterLine: (polygon: Point2D[]) => { start: Point2D; end: Point2D } | null
}

function getItemHitId(context: FloorplanSelectionToolContext) {
  if (!context.isItemContextActive) {
    return null
  }

  const itemHit = context.items.find(({ polygon }) => isPointInsidePolygon(context.point, polygon))
  return itemHit?.item.id ?? null
}

function getStairHitPolygons(stair: StairEntry) {
  return stair.hitPolygons.length > 0
    ? stair.hitPolygons
    : stair.segments.map(({ polygon }) => polygon)
}

export function getFloorplanHitNodeId(context: FloorplanSelectionToolContext) {
  if (context.phase === 'structure') {
    const openingHit = context.openings.find(({ polygon }) => {
      if (isPointInsidePolygon(context.point, polygon)) {
        return true
      }

      const centerLine = context.getOpeningCenterLine(polygon)
      if (!centerLine) {
        return false
      }

      return (
        getDistanceToWallSegment(
          context.point,
          [centerLine.start.x, centerLine.start.y],
          [centerLine.end.x, centerLine.end.y],
        ) <= context.openingHitTolerance
      )
    })
    if (openingHit) {
      return openingHit.opening.id
    }

    const stairHit = context.stairs.find((stair) =>
      getStairHitPolygons(stair).some((polygon) => isPointInsidePolygon(context.point, polygon)),
    )
    if (stairHit) {
      return stairHit.stair.id
    }

    const wallHit = context.walls.find(
      ({ wall, polygon }) =>
        isPointInsidePolygon(context.point, polygon) ||
        getDistanceToWallSegment(context.point, wall.start, wall.end) <= context.wallHitTolerance,
    )
    if (wallHit) {
      return wallHit.wall.id
    }

    const roofHit = context.roofs.find(({ segments }) =>
      segments.some(({ polygon }) => isPointInsidePolygon(context.point, polygon)),
    )
    if (roofHit) {
      return roofHit.roof.id
    }

    const ceilingHit = context.ceilings.find(({ polygon, holes }) =>
      isPointInsidePolygonWithHoles(context.point, polygon, holes),
    )
    if (ceilingHit) {
      return ceilingHit.ceiling.id
    }

    const slabHit = context.slabs.find(({ polygon, holes }) =>
      isPointInsidePolygonWithHoles(context.point, polygon, holes),
    )
    if (slabHit) {
      return slabHit.slab.id
    }
  }

  return getItemHitId(context)
}

type FloorplanSelectionBoundsContext = {
  bounds: FloorplanSelectionBounds
  phase: 'site' | 'structure' | 'furnish'
  isItemContextActive: boolean
  items: ItemEntry[]
  walls: WallEntry[]
  openings: OpeningPolygonEntry[]
  slabs: SlabEntry[]
  ceilings: CeilingEntry[]
  stairs: StairEntry[]
  roofs: RoofEntry[]
}

export function getFloorplanSelectionIdsInBounds({
  bounds,
  phase,
  isItemContextActive,
  items,
  walls,
  openings,
  slabs,
  ceilings,
  stairs,
  roofs,
}: FloorplanSelectionBoundsContext) {
  const itemIds = isItemContextActive
    ? items
        .filter(({ polygon }) => doesPolygonIntersectSelectionBounds(polygon, bounds))
        .map(({ item }) => item.id)
    : []

  if (phase !== 'structure') {
    return itemIds
  }

  const wallIds = walls
    .filter(({ polygon }) => doesPolygonIntersectSelectionBounds(polygon, bounds))
    .map(({ wall }) => wall.id)
  const openingIds = openings
    .filter(({ polygon }) => doesPolygonIntersectSelectionBounds(polygon, bounds))
    .map(({ opening }) => opening.id)
  const slabIds = slabs
    .filter(({ polygon }) => doesPolygonIntersectSelectionBounds(polygon, bounds))
    .map(({ slab }) => slab.id)
  const ceilingIds = ceilings
    .filter(({ polygon }) => doesPolygonIntersectSelectionBounds(polygon, bounds))
    .map(({ ceiling }) => ceiling.id)
  const stairIds = stairs
    .filter((stair) =>
      getStairHitPolygons(stair).some((polygon) =>
        doesPolygonIntersectSelectionBounds(polygon, bounds),
      ),
    )
    .map(({ stair }) => stair.id)
  const roofIds = roofs
    .filter(({ segments }) =>
      segments.some(({ polygon }) => doesPolygonIntersectSelectionBounds(polygon, bounds)),
    )
    .map(({ roof }) => roof.id)

  return Array.from(
    new Set([
      ...itemIds,
      ...wallIds,
      ...openingIds,
      ...slabIds,
      ...ceilingIds,
      ...stairIds,
      ...roofIds,
    ]),
  )
}
