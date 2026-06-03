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
  if (!floorPlaced) return null
  if (floorPlaced.applies && !floorPlaced.applies(node)) return null
  return floorPlaced.footprint(node)
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
 * Footprint AABBs of every floor-placed node except `excludeId`, keyed by
 * node id. The static pool both the resolver (via {@link footprintAnchors})
 * and the gap refinement (via {@link refineGuidesToGap}) draw from. Kinds
 * without a footprint are omitted (bbox-anchors-only, matching v1).
 */
export function collectFloorFootprints(
  nodes: Readonly<Record<string, AnyNode>>,
  excludeId: string,
): Map<string, FootprintAABB> {
  const footprints = new Map<string, FootprintAABB>()
  for (const node of Object.values(nodes)) {
    if (!node || node.id === excludeId) continue
    const aabb = footprintAABB(node)
    if (aabb) footprints.set(node.id, aabb)
  }
  return footprints
}

/** Flatten a footprint map into the corner anchors the resolver matches.
 *  Corners only — alignment locks to item edges, never centrelines. */
export function footprintAnchors(
  footprints: ReadonlyMap<string, FootprintAABB>,
): AlignmentAnchor[] {
  const anchors: AlignmentAnchor[] = []
  for (const [id, b] of footprints) {
    anchors.push(...bboxCornerAnchors(id, b.minX, b.minZ, b.maxX, b.maxZ))
  }
  return anchors
}

/**
 * Convenience: candidate anchors from every other floor-placed node.
 * Equivalent to `footprintAnchors(collectFloorFootprints(nodes, excludeId))`.
 */
export function collectAlignmentCandidates(
  nodes: Readonly<Record<string, AnyNode>>,
  excludeId: string,
): AlignmentAnchor[] {
  return footprintAnchors(collectFloorFootprints(nodes, excludeId))
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
