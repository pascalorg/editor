import type { AnyNode, SlabNode } from '../schema'
import { DEFAULT_SLAB_ELEVATION, MIN_SLAB_THICKNESS } from '../schema/nodes/slab'
import { wallOverlapsSlabFootprint } from '../systems/slab/slab-support'
import { getWallArcData } from '../systems/wall/wall-curve'
import { wallOpeningBand } from './floor-opening-footprints'
import { area, containsPoint, difference, intersection, union } from './polygon-boolean'
import { automaticRoomBaseElevations } from './room-floor-feasibility'
import { isLevelAtSiteDatum } from './terrain-support-query'

const heights = new WeakMap<
  object,
  Map<string, { sources: AnyNode[]; zoneIds: string; height: number }>
>()

export function automaticFloorHeight(
  nodes: Readonly<Record<string, AnyNode>>,
  plate: SlabNode,
): number {
  return plate.referenceFloorElevation ?? supportDerivedFloorHeight(nodes, plate)
}

export function supportDerivedFloorHeight(
  nodes: Readonly<Record<string, AnyNode>>,
  plate: SlabNode,
): number {
  const sources = Object.values(nodes).filter(
    (node) =>
      node.type === 'site' ||
      node.type === 'building' ||
      node.type === 'level' ||
      (node.parentId === plate.parentId &&
        (node.type === 'wall' ||
          node.type === 'separator' ||
          node.type === 'zone' ||
          (node.type === 'slab' && !node.autoFromWalls && node.boundary !== 'auto'))),
  )
  const zoneIds = JSON.stringify(plate.zoneIds)
  let memo = heights.get(nodes)
  if (!memo) {
    memo = new Map()
    heights.set(nodes, memo)
  }
  const hit = memo.get(plate.id)
  if (
    hit &&
    hit.zoneIds === zoneIds &&
    hit.sources.length === sources.length &&
    sources.every((node, i) => node === hit.sources[i])
  )
    return hit.height
  const placements = automaticRoomBaseElevations(nodes, plate.parentId!)
  const values = (plate.zoneIds ?? []).map((id) => placements.get(id) ?? 0.05)
  const height = values.length ? Math.max(...values) : 0.05
  memo.set(plate.id, { sources, zoneIds, height })
  return height
}

export function floorFootprintSupportClass(
  nodes: Readonly<Record<string, AnyNode>>,
  plate: SlabNode,
): 'supported' | 'ground-bearing' {
  const level = nodes[plate.parentId!]
  if (level?.type !== 'level') return 'ground-bearing'
  const buildingId = (levelId: string, parentId: string | null) =>
    (parentId && nodes[parentId]?.type === 'building' ? parentId : undefined) ??
    Object.values(nodes).find(
      (node) => node.type === 'building' && node.children.includes(levelId as never),
    )?.id ??
    null
  const owner = buildingId(level.id, level.parentId)
  const required = Math.max(1.5, area([{ outer: plate.polygon, holes: plate.holes ?? [] }]) * 0.5)
  const overlaps: ReturnType<typeof intersection> = []
  for (const candidate of Object.values(nodes)) {
    if (candidate.type !== 'slab' || candidate.plateRole !== 'base' || candidate.id === plate.id)
      continue
    const lower = nodes[candidate.parentId!]
    if (
      lower?.type === 'level' &&
      buildingId(lower.id, lower.parentId) === owner &&
      lower.level < level.level &&
      candidate.zoneIds?.some((id) => nodes[id]?.type === 'zone' && nodes[id].spaceRole === 'room')
    ) {
      overlaps.push(
        ...intersection(
          { outer: candidate.polygon, holes: candidate.holes ?? [] },
          { outer: plate.polygon, holes: plate.holes ?? [] },
        ),
      )
    }
  }
  return overlaps.length && area(union(overlaps)) >= required ? 'supported' : 'ground-bearing'
}

export function floorPlateAtGroundContact(
  nodes: Readonly<Record<string, AnyNode>>,
  plate: SlabNode,
): boolean {
  return (
    !!plate.parentId &&
    isLevelAtSiteDatum(nodes as Record<string, AnyNode>, plate.parentId) &&
    floorFootprintSupportClass(nodes, plate) === 'ground-bearing'
  )
}

export function floorPlateHoldsUnderside(
  nodes: Readonly<Record<string, AnyNode>>,
  plate: SlabNode,
): boolean {
  return !floorPlateAtGroundContact(nodes, plate)
}

/**
 * A ground-bearing footprint's construction, bottom up: the grade, the
 * foundation on it, the slab on the foundation, so the top is always
 * grade + foundationHeight + thickness. The foundation height is derived from
 * the stored top; a legacy plate whose slab reaches below grade reads 0.
 */
export function groundFloorConstruction(
  nodes: Readonly<Record<string, AnyNode>>,
  plate: SlabNode,
): { grade: number; top: number; thickness: number; foundationHeight: number } {
  const grade = supportDerivedFloorHeight(nodes, plate) - DEFAULT_SLAB_ELEVATION
  const top = plate.floorHeight ?? plate.elevation
  const foundationHeight = Math.round((top - grade - plate.thickness) * 1e6) / 1e6
  return { grade, top, thickness: plate.thickness, foundationHeight: Math.max(0, foundationHeight) }
}

export function floorPlateGestureMinimum(
  nodes: Readonly<Record<string, AnyNode>>,
  plate: SlabNode,
): number {
  return upperFloorHeightControl(nodes, plate)?.minimumTop ?? Number.NEGATIVE_INFINITY
}

export function footprintLift(nodes: Readonly<Record<string, AnyNode>>, plate: SlabNode): number {
  return floorPlateHoldsUnderside(nodes, plate)
    ? (plate.floorHeight ?? plate.elevation) - automaticFloorHeight(nodes, plate)
    : plate.floorHeight !== undefined
      ? plate.floorHeight - automaticFloorHeight(nodes, plate)
      : 0
}

export function upperFloorHeightControl(
  nodes: Readonly<Record<string, AnyNode>>,
  plate: SlabNode,
  targetTop: number = plate.floorHeight ?? plate.elevation,
): {
  currentTop: number
  minimumTop: number
  write: { thickness: number }
  advice?: 'thick-floor'
} | null {
  if (!floorPlateHoldsUnderside(nodes, plate)) return null
  const currentTop = plate.floorHeight ?? plate.elevation
  const underside = currentTop - plate.thickness
  const thickness = targetTop - underside
  const restingUnderside = automaticFloorHeight(nodes, plate) - DEFAULT_SLAB_ELEVATION
  return {
    currentTop,
    minimumTop: underside < restingUnderside - 0.001 ? currentTop : underside + MIN_SLAB_THICKNESS,
    write: { thickness },
    ...(thickness > 0.4 ? { advice: 'thick-floor' as const } : {}),
  }
}

export function resolvedFootprintPlane(
  nodes: Readonly<Record<string, AnyNode>>,
  node: AnyNode,
  storedHeight: number,
): number {
  const lifts = Object.values(nodes).flatMap((plate) =>
    plate.type === 'slab' &&
    plate.plateRole === 'base' &&
    plate.parentId === node.parentId &&
    footprintSupportsNode(plate, node, nodes)
      ? [footprintLift(nodes, plate)]
      : [],
  )
  return storedHeight + (lifts.length ? Math.max(...lifts) : 0)
}

const overlaps = new WeakMap<object, WeakMap<object, WeakMap<object, boolean>>>()

export function footprintSupportsNode(
  base: SlabNode,
  node: AnyNode,
  nodes: Readonly<Record<string, AnyNode>>,
): boolean {
  let byBase = overlaps.get(nodes)
  if (!byBase) {
    byBase = new WeakMap()
    overlaps.set(nodes, byBase)
  }
  let byNode = byBase.get(base)
  if (!byNode) {
    byNode = new WeakMap()
    byBase.set(base, byNode)
  }
  const hit = byNode.get(node)
  if (hit !== undefined) return hit
  const result = computeFootprintSupport(base, node, nodes)
  byNode.set(node, result)
  return result
}

const boundsMemo = new WeakMap<object, number[]>()
const ceilingWallBands = new WeakMap<object, Map<string, ReturnType<typeof union>>>()

function ceilingSupportInterior(
  base: SlabNode,
  node: AnyNode,
  nodes: Readonly<Record<string, AnyNode>>,
) {
  if (node.type !== 'ceiling') return false
  let levels = ceilingWallBands.get(nodes)
  if (!levels) {
    levels = new Map()
    ceilingWallBands.set(nodes, levels)
  }
  let bands = levels.get(base.parentId!)
  if (!bands) {
    bands = union(
      Object.values(nodes).flatMap((wall) =>
        wall.type === 'wall' && wall.parentId === base.parentId
          ? [wallOpeningBand(wall, 0, 1)]
          : [],
      ),
    )
    levels.set(base.parentId!, bands)
  }
  // Captured ceilings can cross a party wall by a wall-thickness sliver.
  // Only overlap extending into the room carries that ceiling with the floor.
  return (
    area(
      difference(
        intersection(
          { outer: base.polygon, holes: base.holes },
          { outer: node.polygon, holes: node.holes },
        ),
        bands,
      ),
    ) > 1e-6
  )
}
function polygonBounds(polygon: [number, number][]) {
  const cached = boundsMemo.get(polygon)
  if (cached) return cached
  const result = [
    Math.min(...polygon.map(([x]) => x)),
    Math.min(...polygon.map(([, z]) => z)),
    Math.max(...polygon.map(([x]) => x)),
    Math.max(...polygon.map(([, z]) => z)),
  ]
  boundsMemo.set(polygon, result)
  return result
}

function polygonsOverlap(base: SlabNode, polygon: [number, number][]) {
  const a = polygonBounds(base.polygon),
    b = polygonBounds(polygon)
  return (
    a[0]! < b[2]! &&
    b[0]! < a[2]! &&
    a[1]! < b[3]! &&
    b[1]! < a[3]! &&
    area(intersection({ outer: base.polygon, holes: base.holes ?? [] }, polygon)) > 1e-6
  )
}

function computeFootprintSupport(
  base: SlabNode,
  node: AnyNode,
  nodes: Readonly<Record<string, AnyNode>>,
): boolean {
  if (node.type === 'wall') {
    const bounds = polygonBounds(base.polygon)
    const margin = node.thickness ?? 0.15
    const arc = getWallArcData(node)
    const xs = arc
      ? [arc.center.x - arc.radius, arc.center.x + arc.radius]
      : [node.start[0], node.end[0]]
    const zs = arc
      ? [arc.center.y - arc.radius, arc.center.y + arc.radius]
      : [node.start[1], node.end[1]]
    if (
      Math.max(...xs) + margin < bounds[0]! ||
      Math.min(...xs) - margin > bounds[2]! ||
      Math.max(...zs) + margin < bounds[1]! ||
      Math.min(...zs) - margin > bounds[3]!
    )
      return false
    return wallOverlapsSlabFootprint(node, base.polygon, base.holes)
  }
  if (node.type === 'ceiling' && node.parentId === base.parentId)
    return polygonsOverlap(base, node.polygon) && ceilingSupportInterior(base, node, nodes)
  if (node.type === 'slab' || node.type === 'zone' || node.type === 'ceiling')
    return polygonsOverlap(base, node.polygon)
  if (node.type === 'roof') {
    const segments = node.children
      .map((id) => nodes[id])
      .filter((segment) => segment?.type === 'roof-segment')
    if (!segments.length)
      return containsPoint(
        [{ outer: base.polygon, holes: base.holes ?? [] }],
        [node.position[0], node.position[2]],
      )
    return segments.some((segment) => {
      if (segment.type !== 'roof-segment') return false
      const corners: [number, number][] = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]
      const polygon = corners.map(([sx, sz]): [number, number] => {
        const x = (sx * segment.width) / 2,
          z = (sz * segment.depth) / 2
        const rx =
          segment.position[0] + x * Math.cos(segment.rotation) + z * Math.sin(segment.rotation)
        const rz =
          segment.position[2] - x * Math.sin(segment.rotation) + z * Math.cos(segment.rotation)
        return [
          node.position[0] + rx * Math.cos(node.rotation) + rz * Math.sin(node.rotation),
          node.position[2] - rx * Math.sin(node.rotation) + rz * Math.cos(node.rotation),
        ]
      })
      return polygonsOverlap(base, polygon)
    })
  }
  return false
}
