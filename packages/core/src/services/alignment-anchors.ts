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
import { DEFAULT_WALL_THICKNESS } from '../systems/wall/wall-footprint'
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

/** The relocatable box footprint for a node, or null when it has none
 *  (walls / slabs / polygon kinds) or the kind's predicate excludes it
 *  (e.g. a wall-attached item that doesn't rest on the floor).
 *
 *  Box footprints come from one of two capabilities: `floorPlaced` (kinds
 *  whose Y is also slab-lifted — columns, items) or `alignmentFootprint`
 *  with a `box` shape (kinds that align by their footprint but aren't
 *  floor-coupled — the elevator's outer shaft). A kind whose
 *  `alignmentFootprint` is an `aabb` (stair) has no centred box, so it's
 *  resolved directly in `nodeAlignmentAnchors`, not here. */
function floorFootprint(
  node: AnyNode,
): { dimensions: [number, number, number]; rotation: [number, number, number] } | null {
  const capabilities = nodeRegistry.get(node.type)?.capabilities
  const floorPlaced = capabilities?.floorPlaced
  // `footprint` is optional now that floor-placed kinds may instead declare
  // composite `footprints` (e.g. stairs); those have no single centred box
  // here, so fall through to `alignmentFootprint`.
  if (floorPlaced?.footprint) {
    if (floorPlaced.applies && !floorPlaced.applies(node)) return null
    return floorPlaced.footprint(node)
  }
  const alignment = capabilities?.alignmentFootprint?.(node)
  if (alignment?.shape === 'box') {
    return { dimensions: alignment.dimensions, rotation: alignment.rotation }
  }
  return null
}

/**
 * XZ bounding box a node occupies in plan, unifying the two non-structural
 * sources: a relocatable box (`floorFootprint`, covering floor-placed kinds
 * and the elevator's alignment box) and a kind that hands back an explicit
 * `aabb` because its plan shape isn't a centred rectangle (stair). Returns
 * null for kinds with neither.
 */
function alignmentAABB(
  node: AnyNode,
  nodes?: Readonly<Record<string, AnyNode>>,
): FootprintAABB | null {
  const box = footprintAABB(node)
  if (box) return box
  const alignment = nodeRegistry.get(node.type)?.capabilities?.alignmentFootprint?.(node, nodes)
  if (alignment?.shape === 'aabb') {
    return {
      minX: alignment.minX,
      minZ: alignment.minZ,
      maxX: alignment.maxX,
      maxZ: alignment.maxZ,
    }
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

function relocatedPlanNode(node: AnyNode, x: number, z: number, rotationY?: number): AnyNode {
  const position = (node as { position?: unknown }).position
  const y = Array.isArray(position) && typeof position[1] === 'number' ? position[1] : 0
  const relocated: Record<string, unknown> = {
    ...(node as Record<string, unknown>),
    position: [x, y, z],
  }

  if (rotationY !== undefined && 'rotation' in node) {
    const rotation = (node as { rotation?: unknown }).rotation
    relocated.rotation = Array.isArray(rotation)
      ? [rotation[0] ?? 0, rotationY, rotation[2] ?? 0]
      : rotationY
  }

  return relocated as AnyNode
}

/**
 * Corner anchors for a moving node relocated to the proposed plan position.
 * Covers both the centred-box path (`floorPlaced.footprint` /
 * `alignmentFootprint: box`) and explicit AABB footprints such as stairs,
 * whose occupied plan bounds depend on children or curved/spiral geometry.
 */
export function movingAlignmentAnchors(
  node: AnyNode,
  nodes: Readonly<Record<string, AnyNode>> | undefined,
  x: number,
  z: number,
  rotationY?: number,
): AlignmentAnchor[] {
  const box = footprintAABBAt(node, x, z, rotationY)
  if (box) return bboxCornerAnchors(node.id, box.minX, box.minZ, box.maxX, box.maxZ)

  const alignment = nodeRegistry
    .get(node.type)
    ?.capabilities?.alignmentFootprint?.(relocatedPlanNode(node, x, z, rotationY), nodes)

  if (alignment?.shape === 'box') {
    const aabb = footprintAABBFrom([x, 0, z], alignment.dimensions, alignment.rotation[1] ?? 0)
    return bboxCornerAnchors(node.id, aabb.minX, aabb.minZ, aabb.maxX, aabb.maxZ)
  }
  if (alignment?.shape === 'aabb') {
    return bboxCornerAnchors(
      node.id,
      alignment.minX,
      alignment.minZ,
      alignment.maxX,
      alignment.maxZ,
    )
  }

  return []
}

/**
 * Alignment anchors for a wall segment: the two centerline endpoints + chord
 * midpoint, plus — when `thickness` is known — four **face** corner anchors,
 * each endpoint offset by ±thickness/2 perpendicular to the wall axis.
 *
 * The face anchors are what let a footprint align to a wall's *face* rather
 * than its centerline: for an axis-aligned wall the two same-side face
 * anchors share a constant X (vertical wall) or Z (horizontal wall) running
 * the wall's full length, so the point-to-point resolver snaps a moving
 * corner flush to the face anywhere along the wall (the perpendicular
 * tie-break connects the guide to the nearer face endpoint). A diagonal wall
 * gets only its face/centerline endpoints — point-to-point can't represent a
 * sloped face line; that's an accepted v1 limitation.
 *
 * Curve offset is ignored — endpoints are exact and the chord midpoint is
 * good enough for v1. Coordinates are the wall's `start` / `end`
 * (building-local XZ meters).
 */
export function wallSegmentAnchors(
  id: string,
  start: readonly [number, number],
  end: readonly [number, number],
  thickness?: number,
): AlignmentAnchor[] {
  const anchors: AlignmentAnchor[] = [
    { nodeId: id, kind: 'corner', x: start[0], z: start[1] },
    { nodeId: id, kind: 'corner', x: end[0], z: end[1] },
    { nodeId: id, kind: 'center', x: (start[0] + end[0]) / 2, z: (start[1] + end[1]) / 2 },
  ]

  if (thickness && thickness > 0) {
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const len = Math.hypot(dx, dz)
    if (len > 1e-6) {
      // Perpendicular to the wall axis, scaled to half-thickness.
      const half = thickness / 2
      const px = (-dz / len) * half
      const pz = (dx / len) * half
      for (const [bx, bz] of [start, end] as const) {
        anchors.push({ nodeId: id, kind: 'corner', x: bx + px, z: bz + pz })
        anchors.push({ nodeId: id, kind: 'corner', x: bx - px, z: bz - pz })
      }
    }
  }

  return anchors
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
 * kind: walls / fences → segment endpoints + midpoint; slabs / ceilings →
 * polygon vertices; everything else → the corners of its plan bounding box
 * (`alignmentAABB`, which covers floor-placed kinds, the elevator's
 * alignment box, and the stair's chain / sector footprint). Kinds with no
 * usable footprint contribute nothing.
 *
 * `nodes` is needed only by kinds whose footprint walks siblings / children
 * (a straight stair's `stair-segment` chain); every other kind derives its
 * anchors from `node` alone.
 */
export function nodeAlignmentAnchors(
  node: AnyNode,
  nodes?: Readonly<Record<string, AnyNode>>,
): AlignmentAnchor[] {
  if (node.type === 'wall' || node.type === 'fence') {
    const seg = node as {
      id: string
      start: [number, number]
      end: [number, number]
      thickness?: number
    }
    // Wall thickness is schema-optional (falls back to the geometry default);
    // fence always carries one. Either way, pass it through so faces align.
    return wallSegmentAnchors(seg.id, seg.start, seg.end, seg.thickness ?? DEFAULT_WALL_THICKNESS)
  }
  if (node.type === 'slab' || node.type === 'ceiling') {
    const poly = (node as { polygon?: [number, number][] }).polygon
    return poly ? polygonAnchors(node.id, poly) : []
  }

  const anchors: AlignmentAnchor[] = []

  // Box footprint (items, columns, shelves, stairs, …).
  const aabb = alignmentAABB(node, nodes)
  if (aabb) {
    anchors.push(...bboxCornerAnchors(node.id, aabb.minX, aabb.minZ, aabb.maxX, aabb.maxZ))
  }

  // Polyline kinds (duct / pipe / lineset): every path vertex is an anchor,
  // so anything dragged snaps to a run's ends and bends.
  const path = (node as { path?: unknown }).path
  if (Array.isArray(path)) {
    for (const p of path as Array<[number, number, number]>) {
      anchors.push({ nodeId: node.id, kind: 'corner', x: p[0], z: p[2] })
    }
  }

  // Typed ports (fittings, equipment, terminals, run ends): connection points
  // are natural alignment targets — line a new run up with an existing collar.
  const ports = nodeRegistry.get(node.type)?.ports?.(node)
  if (ports) {
    for (const port of ports) {
      anchors.push({ nodeId: node.id, kind: 'corner', x: port.position[0], z: port.position[2] })
    }
  }

  // Position-based kinds with no footprint (e.g. duct fittings): the origin
  // itself is a useful centre anchor.
  if (!aabb) {
    const position = (node as { position?: [number, number, number] }).position
    if (Array.isArray(position)) {
      anchors.push({ nodeId: node.id, kind: 'center', x: position[0], z: position[2] })
    }
  }

  return anchors
}

/**
 * Resolve the level a node belongs to by walking its `parentId` chain, or
 * null when it isn't under a level. Inlined here (rather than importing the
 * spatial-grid `resolveLevelId`) to keep this services module free of
 * hook / store dependencies.
 */
function resolveNodeLevelId(
  node: AnyNode,
  nodes: Readonly<Record<string, AnyNode>>,
): string | null {
  let current: AnyNode | undefined = node
  while (current) {
    if (current.type === 'level') return current.id
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return null
}

/**
 * Anchors from every alignable node except `excludeId` — the unified
 * candidate pool every move / placement tool resolves against, so any
 * draggable object can align to any other (items, walls, fences, slabs,
 * ceilings, columns).
 *
 * When `levelId` is given, nodes that belong to a *different* level are
 * dropped. Alignment is XZ-only, so without this a node directly below on
 * another floor (e.g. the ground floor while you place on the first) would
 * snap and draw a guide even though the two sit at different heights.
 * Building-/site-scoped nodes with no level ancestor (e.g. an elevator
 * shaft, which is parented to the building and spans every floor) resolve to
 * null and stay in the pool so they align on any floor. The 2D floor-plan
 * deliberately omits the filter — aligning a wall to the one directly below
 * in plan is the whole point of the reference floor.
 */
export function collectAlignmentAnchors(
  nodes: Readonly<Record<string, AnyNode>>,
  excludeId: string,
  levelId?: string | null,
): AlignmentAnchor[] {
  const anchors: AlignmentAnchor[] = []
  for (const node of Object.values(nodes)) {
    if (!node || node.id === excludeId) continue
    if (levelId) {
      const nodeLevelId = resolveNodeLevelId(node, nodes)
      if (nodeLevelId !== null && nodeLevelId !== levelId) continue
    }
    anchors.push(...nodeAlignmentAnchors(node, nodes))
  }
  return anchors
}
