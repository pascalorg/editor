/**
 * Node → alignment-anchor adapters.
 *
 * `alignment.ts` is pure geometry and knows nothing about nodes. This
 * module bridges the scene graph to it: it reads a floor-placed kind's
 * footprint from the registry and turns it into the bbox anchors the
 * resolver matches against. Kept out of `alignment.ts` so that file stays
 * registry-free.
 *
 * All coordinates are XZ meters in the same frame as `node.position`
 * (building-local for nodes inside a building). The 3D move producer works
 * entirely in that frame, so the resulting guides line up with the cursor.
 */

import { nodeRegistry } from '../registry'
import type { AnyNode } from '../schema/types'
import { type AlignmentAnchor, bboxCornerAnchors } from './alignment'

export type FootprintAABB = { minX: number; minZ: number; maxX: number; maxZ: number }

/**
 * Axis-aligned XZ bounding box of a rotated rectangle centred at
 * `position`. Mirrors the rotated-corner math the spatial-grid manager
 * uses (`getItemFootprint`) so alignment anchors coincide with the
 * footprint used for collision / slab elevation.
 */
export function footprintAABBFrom(
  position: readonly [number, number, number],
  dimensions: readonly [number, number, number],
  rotationY: number,
): FootprintAABB {
  const [x, , z] = position
  const [w, , d] = dimensions
  const halfW = w / 2
  const halfD = d / 2
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)

  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const [lx, lz] of [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ] as const) {
    const wx = x + (lx * cos - lz * sin)
    const wz = z + (lx * sin + lz * cos)
    if (wx < minX) minX = wx
    if (wx > maxX) maxX = wx
    if (wz < minZ) minZ = wz
    if (wz > maxZ) maxZ = wz
  }

  return { minX, minZ, maxX, maxZ }
}

/** The floor-placed footprint config for a node, or null when it has none
 *  (walls / slabs / polygon kinds) or the kind's predicate excludes it
 *  (e.g. a wall-attached item that doesn't rest on the floor). */
function floorFootprint(
  node: AnyNode,
): { dimensions: [number, number, number]; rotation: [number, number, number] } | null {
  const floorPlaced = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
  if (floorPlaced) {
    if (floorPlaced.applies && !floorPlaced.applies(node)) return null
    return floorPlaced.footprint(node)
  }
  // Elevator isn't a `floorPlaced` kind (no slab-elevation coupling) but it
  // does rest on the floor with a `width × depth` cab — give it a footprint
  // so it aligns like other boxes (the registry move tool reads this).
  if (node.type === 'elevator') {
    const e = node as { width?: number; depth?: number; rotation?: number }
    return { dimensions: [e.width ?? 1.6, 1, e.depth ?? 1.6], rotation: [0, e.rotation ?? 0, 0] }
  }
  return null
}

/** XZ footprint AABB of a floor-placed node at its current position, or
 *  null for kinds without a usable footprint. */
export function footprintAABB(node: AnyNode): FootprintAABB | null {
  const fp = floorFootprint(node)
  if (!fp) return null
  const position = (node as { position?: [number, number, number] }).position ?? [0, 0, 0]
  return footprintAABBFrom(position, fp.dimensions, fp.rotation[1] ?? 0)
}

/** XZ footprint AABB of a floor-placed node relocated so its centre sits at
 *  the proposed (x, z). `rotationY` overrides the node's footprint rotation
 *  (R/T bumps it before the scene commit lands). Null when no footprint. */
export function footprintAABBAt(
  node: AnyNode,
  x: number,
  z: number,
  rotationY?: number,
): FootprintAABB | null {
  const fp = floorFootprint(node)
  if (!fp) return null
  return footprintAABBFrom([x, 0, z], fp.dimensions, rotationY ?? fp.rotation[1] ?? 0)
}

/**
 * Corner anchors for the moving node's footprint relocated so its centre
 * sits at the proposed (x, z). Corners only — the moving item aligns by its
 * edges, never its centreline. Returns [] when the kind has no footprint.
 */
export function movingFootprintAnchors(
  node: AnyNode,
  x: number,
  z: number,
  rotationY?: number,
): AlignmentAnchor[] {
  const aabb = footprintAABBAt(node, x, z, rotationY)
  if (!aabb) return []
  return bboxCornerAnchors(node.id, aabb.minX, aabb.minZ, aabb.maxX, aabb.maxZ)
}

/**
 * Alignment anchors for a wall segment: both endpoints (as `corner`) and
 * the chord midpoint (as `center`). Curve offset is ignored — endpoints are
 * exact and the midpoint is good enough for v1 alignment. Coordinates are
 * the wall's `start` / `end` (building-local XZ meters).
 */
export function wallSegmentAnchors(
  id: string,
  start: readonly [number, number],
  end: readonly [number, number],
): AlignmentAnchor[] {
  return [
    { nodeId: id, kind: 'corner', x: start[0], z: start[1] },
    { nodeId: id, kind: 'corner', x: end[0], z: end[1] },
    { nodeId: id, kind: 'center', x: (start[0] + end[0]) / 2, z: (start[1] + end[1]) / 2 },
  ]
}

/** Each vertex of a polygon (slab / ceiling footprint) as a `corner` anchor. */
export function polygonAnchors(
  id: string,
  points: readonly (readonly [number, number])[],
): AlignmentAnchor[] {
  return points.map(([x, z]) => ({ nodeId: id, kind: 'corner' as const, x, z }))
}

/**
 * Alignment anchors a node contributes to the candidate pool, dispatched by
 * kind: floor-placed footprints → corner anchors; walls / fences → segment
 * endpoints + midpoint; slabs / ceilings → polygon vertices. Kinds without a
 * usable footprint contribute nothing.
 */
export function nodeAlignmentAnchors(node: AnyNode): AlignmentAnchor[] {
  if (node.type === 'wall' || node.type === 'fence') {
    const seg = node as { id: string; start: [number, number]; end: [number, number] }
    return wallSegmentAnchors(seg.id, seg.start, seg.end)
  }
  if (node.type === 'slab' || node.type === 'ceiling') {
    const poly = (node as { polygon?: [number, number][] }).polygon
    return poly ? polygonAnchors(node.id, poly) : []
  }
  const aabb = footprintAABB(node)
  return aabb ? bboxCornerAnchors(node.id, aabb.minX, aabb.minZ, aabb.maxX, aabb.maxZ) : []
}

/**
 * Anchors from every alignable node except `excludeId` — the unified
 * candidate pool every move / placement tool resolves against, so any
 * draggable object can align to any other (items, walls, fences, slabs,
 * ceilings, columns).
 */
export function collectAlignmentAnchors(
  nodes: Readonly<Record<string, AnyNode>>,
  excludeId: string,
): AlignmentAnchor[] {
  const anchors: AlignmentAnchor[] = []
  for (const node of Object.values(nodes)) {
    if (!node || node.id === excludeId) continue
    anchors.push(...nodeAlignmentAnchors(node))
  }
  return anchors
}
