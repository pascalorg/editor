import { boundaries, roomFace } from '../commands/structure/shared'
import type { AnyNode, SlabNode, WallNode } from '../schema'
import {
  DEFAULT_SLAB_ELEVATION,
  MIN_GROUND_FLOOR_THICKNESS,
  MIN_SLAB_THICKNESS,
} from '../schema/nodes/slab'
import { getStoredLevelHeight, getWallPlaneTop } from '../services/storey'
import { getWallCurveFrameAt, getWallCurveLength } from '../systems/wall/wall-curve'
import { MIN_WALL_HEIGHT, resolveWallTop } from '../systems/wall/wall-top'
import { floorPlateHoldsUnderside, footprintLift } from './floor-foundation-datum'
import { isFloorAnchoredOpening } from './floor-opening-footprints'
import { floorRoomFaces } from './floor-room-faces'
import {
  getOpeningFloorTarget,
  openingFitsAtDatum,
  supportSegmentAt,
  wallSupportForNodes,
} from './opening-floor-datum'
import { area, intersection, union } from './polygon-boolean'
import { autoRoomVerticalPlacements } from './room-vertical-placement'

export const FLOOR_ELEVATION_EPSILON = 0.001
export { MIN_GROUND_FLOOR_THICKNESS, MIN_SLAB_THICKNESS }

export type RoomFloorConflict = {
  code:
    | 'floor-foundation-level'
    | 'floor-foundation-shared-storey'
    | 'floor-plate-thickness'
    | 'floor-wall-fit'
    | 'floor-headroom'
    | 'floor-opening-fit'
    | 'floor-window-sill'
    | 'floor-sunken-depth'
    | 'floor-low-headroom'
    | 'floor-door-step'
    | 'floor-door-swing'
  nodeIds: string[]
  message: string
  severity: 'error' | 'warning'
  excess?: number
}

const roomBaseMemo = new WeakMap<object, Map<string, number>>()

export function getRoomBaseElevation(
  nodes: Readonly<Record<string, AnyNode>>,
  zoneId: string,
): number {
  const zone = nodes[zoneId]
  const levelId = zone?.parentId
  if (!levelId) return DEFAULT_SLAB_ELEVATION
  const plate = Object.values(nodes).find(
    (node): node is SlabNode =>
      node.type === 'slab' &&
      node.plateRole === 'base' &&
      !!node.zoneIds?.includes(zoneId as never),
  )
  if (plate) return plate.floorHeight ?? plate.elevation
  if (
    zone?.type !== 'zone' ||
    zone.spaceRole !== 'room' ||
    zone.hasFloor === false ||
    zone.enclosureStatus === 'open' ||
    zone.floor?.support === 'open'
  )
    return DEFAULT_SLAB_ELEVATION
  let cache = roomBaseMemo.get(nodes)
  if (!cache) {
    cache = new Map()
    roomBaseMemo.set(nodes, cache)
  }
  const cached = cache.get(zoneId)
  if (cached !== undefined) return cached
  const face = roomFace(nodes, zone, floorRoomFaces(boundaries(nodes, levelId)))
  if (!face) return DEFAULT_SLAB_ELEVATION
  const polygon = { outer: face.referencePolygon, holes: face.holes }
  const covered = union(
    Object.values(nodes).flatMap((node) =>
      node.type === 'slab' &&
      node.parentId === levelId &&
      !node.autoFromWalls &&
      node.boundary !== 'auto'
        ? intersection(polygon, { outer: node.polygon, holes: node.holes })
        : [],
    ),
  )
  const elevation =
    area(covered) >= area([polygon]) * 0.6
      ? DEFAULT_SLAB_ELEVATION
      : (autoRoomVerticalPlacements([{ ...face, zone }], nodes).get(zone.id) ??
        DEFAULT_SLAB_ELEVATION)
  cache.set(zoneId, elevation)
  return elevation
}

const automaticBaseMemo = new Map<string, ReadonlyMap<string, number>>()

export function automaticRoomBaseElevations(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string,
): ReadonlyMap<string, number> {
  const signature = JSON.stringify([
    levelId,
    Object.values(nodes)
      .filter(
        (node) =>
          node.type === 'site' ||
          node.type === 'building' ||
          node.type === 'level' ||
          (node.parentId === levelId &&
            (node.type === 'wall' ||
              node.type === 'separator' ||
              node.type === 'zone' ||
              (node.type === 'slab' && !node.autoFromWalls && node.boundary !== 'auto'))),
      )
      .map((node) =>
        node.type === 'zone'
          ? {
              id: node.id,
              type: node.type,
              parentId: node.parentId,
              polygon: node.polygon,
              holes: node.holes,
              seed: node.seed,
              spaceRole: node.spaceRole,
              hasFloor: node.hasFloor,
              enclosureStatus: node.enclosureStatus,
              support: node.floor?.support,
              boundaryWallIds: node.boundaryWallIds,
              boundarySeparatorIds: node.boundarySeparatorIds,
            }
          : node,
      ),
  ])
  const hit = automaticBaseMemo.get(signature)
  if (hit) return hit
  const faces = floorRoomFaces(boundaries(nodes, levelId))
  const manual = union(
    Object.values(nodes).flatMap((node) =>
      node.type === 'slab' &&
      node.parentId === levelId &&
      node.boundary !== 'auto' &&
      !node.autoFromWalls
        ? [{ outer: node.polygon, holes: node.holes }]
        : [],
    ),
  )
  const rooms = Object.values(nodes).flatMap((zone) => {
    if (
      zone.type !== 'zone' ||
      zone.parentId !== levelId ||
      zone.spaceRole !== 'room' ||
      zone.hasFloor === false ||
      zone.enclosureStatus === 'open' ||
      zone.floor?.support === 'open'
    )
      return []
    const face = roomFace(nodes, zone, faces)
    if (!face) return []
    const polygon = { outer: face.referencePolygon, holes: face.holes }
    return area(intersection(polygon, manual)) >= area([polygon]) * 0.6
      ? []
      : [{ ...face, id: zone.id, polygon: face.referencePolygon, zone }]
  })
  const placements = autoRoomVerticalPlacements(rooms, nodes)
  if (automaticBaseMemo.size >= 32) automaticBaseMemo.delete(automaticBaseMemo.keys().next().value!)
  automaticBaseMemo.set(signature, placements)
  return placements
}

const feasibilityMemo = new WeakMap<object, Map<string, ReturnType<typeof computeRoomFloor>>>()

export function checkRoomFloor(
  nodes: Readonly<Record<string, AnyNode>>,
  zoneId: string,
  proposedElevation: number,
) {
  let cache = feasibilityMemo.get(nodes)
  if (!cache) {
    cache = new Map()
    feasibilityMemo.set(nodes, cache)
  }
  const key = `${zoneId}:${proposedElevation}`
  const hit = cache.get(key)
  if (hit) return hit
  const result = computeRoomFloor(nodes, zoneId, proposedElevation)
  cache.set(key, result)
  return result
}

function computeRoomFloor(
  nodes: Readonly<Record<string, AnyNode>>,
  zoneId: string,
  proposedElevation: number,
) {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone') throw new Error(`Room not found: ${zoneId}`)
  const level = nodes[zone.parentId!]
  if (level?.type !== 'level') throw new Error(`Level not found: ${zone.parentId}`)
  const candidate =
    (zone.floor?.elevation ?? getRoomBaseElevation(nodes, zoneId)) === proposedElevation
      ? nodes
      : {
          ...nodes,
          [zoneId]: { ...zone, floor: { ...zone.floor, elevation: proposedElevation } },
        }
  const linked = zone.boundaryWallIds?.length ? new Set(zone.boundaryWallIds) : undefined
  const spans = linked
    ? []
    : (roomFace(nodes, zone, floorRoomFaces(boundaries(nodes, zone.parentId!)))?.spans ?? [])
  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node.type === 'wall' &&
      (linked?.has(node.id) ?? spans.some((span) => span.boundaryId === node.id)),
  )
  const conflicts: RoomFloorConflict[] = []
  const hints: RoomFloorConflict[] = []
  let ceiling = getStoredLevelHeight(level)
  let minElevation = Number.NEGATIVE_INFINITY
  let maxElevation = getStoredLevelHeight(level) - MIN_WALL_HEIGHT
  const base = Object.values(nodes).find(
    (node): node is SlabNode =>
      node.type === 'slab' &&
      node.parentId === level.id &&
      node.plateRole === 'base' &&
      !!node.zoneIds?.includes(zone.id),
  )
  const lift = base ? footprintLift(nodes, base) : 0
  ceiling += lift
  maxElevation += lift
  if (zone.floor?.support !== 'open' && base && floorPlateHoldsUnderside(nodes, base)) {
    minElevation =
      getRoomBaseElevation(nodes, zoneId) - (base?.thickness ?? 0.05) + MIN_SLAB_THICKNESS
    if (proposedElevation < minElevation - 1e-9)
      conflicts.push({
        code: 'floor-sunken-depth',
        excess: minElevation - proposedElevation,
        nodeIds: [zoneId, ...(base ? [base.id] : [])],
        severity: 'error',
        message: `Floor must be at least ${roundFloorElevation(minElevation)} m to retain the level soffit.`,
      })
  }
  for (const wall of walls) {
    const hasOpenings = wall.children.some(
      (id) => nodes[id]?.type === 'door' || nodes[id]?.type === 'window',
    )
    const support =
      hasOpenings || wall.height !== undefined ? wallSupportForNodes(wall, candidate) : undefined
    const top = resolveWallTop(
      wall,
      getWallPlaneTop(wall, level.id, nodes),
      support?.elevation ?? 0,
    )
    const openingSpans =
      hasOpenings && linked
        ? (roomFace(nodes, zone, floorRoomFaces(boundaries(nodes, zone.parentId!)))?.spans ?? [])
        : spans
    maxElevation = Math.min(maxElevation, top - MIN_WALL_HEIGHT)
    ceiling = Math.min(ceiling, top)
    const length = getWallCurveLength(wall)
    for (const id of wall.children) {
      const opening = nodes[id]
      if (opening?.type !== 'door' && opening?.type !== 'window') continue
      const chord = (distance: number) => {
        const point = getWallCurveFrameAt(wall, distance / length).point
        const dx = wall.end[0] - wall.start[0],
          dz = wall.end[1] - wall.start[1]
        return (
          ((point.x - wall.start[0]) * dx + (point.y - wall.start[1]) * dz) / (dx * dx + dz * dz)
        )
      }
      const from = chord(opening.position[0] - opening.width / 2),
        to = chord(opening.position[0] + opening.width / 2)
      if (
        !openingSpans.some(
          (span) => span.boundaryId === wall.id && Math.min(to, span.t1) > Math.max(from, span.t0),
        )
      )
        continue
      const datum = getOpeningFloorTarget(wall, opening, candidate)
      const bottom = opening.position[1] - opening.height / 2
      if (isFloorAnchoredOpening(opening)) {
        if (opening.type === 'door') {
          const from = Math.max(0, (opening.position[0] - opening.width / 2) / length)
          const to = Math.min(1, (opening.position[0] + opening.width / 2) / length)
          const floors = (face: 'a' | 'b') =>
            support!.faceDatum[face].flatMap((run) => {
              const start = Math.max(from, run.start),
                end = Math.min(to, run.end)
              return end > start ? [supportSegmentAt(run, start), supportSegmentAt(run, end)] : []
            })
          const lower = Math.min(datum, ...floors('a'), ...floors('b'))
          if (datum - lower > 0.2 + 1e-9)
            hints.push({
              code: 'floor-door-step',
              nodeIds: [zoneId, id],
              severity: 'warning',
              message: 'The doorway step exceeds 20 cm and needs steps.',
            })
          const swingsToA =
            (opening.swingDirection === 'inward') === Math.cos(opening.rotation[1]) >= 0
          if (
            ['hinged', 'double', 'french'].includes(opening.doorType) &&
            datum - Math.min(datum, ...floors(swingsToA ? 'a' : 'b')) > 0.02 + 1e-9
          )
            hints.push({
              code: 'floor-door-swing',
              nodeIds: [zoneId, id],
              severity: 'warning',
              message: 'The door swings toward the lower floor across a step.',
            })
        }
        const limit = top - opening.position[1] - opening.height / 2
        maxElevation = Math.min(maxElevation, limit)
        if (!openingFitsAtDatum(wall, opening, datum, candidate, support))
          conflicts.push({
            code: 'floor-opening-fit',
            excess: datum + opening.position[1] + opening.height / 2 - top,
            nodeIds: [zoneId, id],
            severity: 'error',
            message: `Floor must be at most ${roundFloorElevation(limit)} m for ${opening.name || opening.type} to fit.`,
          })
      } else if (datum + bottom < proposedElevation - FLOOR_ELEVATION_EPSILON)
        conflicts.push({
          code: 'floor-window-sill',
          nodeIds: [zoneId, id],
          severity: 'warning',
          message: 'The opening sill is below the room floor.',
        })
    }
  }
  if (
    proposedElevation > maxElevation + 1e-9 &&
    !conflicts.some((c) => c.code === 'floor-opening-fit')
  )
    conflicts.push({
      code: 'floor-headroom',
      excess: proposedElevation - maxElevation,
      nodeIds: [zoneId],
      severity: 'error',
      message: `Floor must be at most ${roundFloorElevation(maxElevation)} m to retain minimum headroom.`,
    })
  if (ceiling - proposedElevation < 2.1 - 1e-9)
    hints.push({
      code: 'floor-low-headroom',
      nodeIds: [zoneId],
      severity: 'warning',
      message: 'Headroom is below 2.10 m.',
    })
  conflicts.push(...hints)
  const elevation = Math.max(minElevation, Math.min(maxElevation, proposedElevation))
  return {
    conflicts,
    minElevation,
    maxElevation,
    elevation,
    clamped: elevation !== proposedElevation,
  }
}

export function roundFloorElevation(elevation: number): number {
  return Math.round(elevation * 1e6) / 1e6
}

export function getRoomRelativeFloorElevation(
  nodes: Readonly<Record<string, AnyNode>>,
  zoneId: string,
): number {
  const zone = nodes[zoneId]
  return roundFloorElevation(
    ((zone?.type === 'zone' ? zone.floor?.elevation : undefined) ??
      getRoomBaseElevation(nodes, zoneId)) - getRoomBaseElevation(nodes, zoneId),
  )
}

export function roomFloorElevationFromRelative(
  nodes: Readonly<Record<string, AnyNode>>,
  zoneId: string,
  height: number,
): number {
  return roundFloorElevation(getRoomBaseElevation(nodes, zoneId) + height)
}

export function clampRoomFloorHandle(
  nodes: Readonly<Record<string, AnyNode>>,
  zoneId: string,
  proposed: number,
): number {
  const check = checkRoomFloor(nodes, zoneId, proposed)
  const zone = nodes[zoneId]
  const current =
    zone?.type === 'zone'
      ? (zone.floor?.elevation ?? getRoomBaseElevation(nodes, zoneId))
      : proposed
  // Existing overloads may improve incrementally without snapping to another floor.
  const max = Math.max(current, Math.floor((check.maxElevation + 1e-9) / 0.05) * 0.05)
  const min = Math.min(current, Math.ceil((check.minElevation - 1e-9) / 0.05) * 0.05)
  return roundFloorElevation(Math.max(min, Math.min(max, proposed)))
}
