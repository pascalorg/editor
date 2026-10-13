import {
  type AnyNode,
  type AnyNodeId,
  type ColumnNode,
  getLevelElevations,
  getSegmentSlopeFrame,
  type RoofNode,
  type RoofSegmentNode,
  resolveLevelId,
} from '@pascal-app/core'
import * as THREE from 'three'
import { getRoofSegmentUndersidePolygons } from './roof-system'

/**
 * Roof undersides as data: the planar pieces of every roof's deck bottom in
 * building space. Walls are cut at them (`wall-roof-fit`), every other mesh too
 * (`roof-clip`), and posts reach them.
 */

/** A planar piece of a roof underside in building plan space. */
export type RoofUndersidePatch = {
  /** Plan polygon (x, z). */
  polygon: Array<[number, number]>
  /** Underside height in building space: `y = a * x + b * z + c`. */
  a: number
  b: number
  c: number
  ordinal: number
  roofId: string
  /** Vertical depth of deck and shingles: the roof's top is `underside + thickness`. */
  thickness: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

// Metres. A roof must clear a base by 1 mm to cap what stands on it (a deck
// lying on the base is under it, not over it).
export const ROOF_CLEARANCE = 1e-3

const patchMemo = new WeakMap<object, Map<string | null, RoofUndersidePatch[]>>()

export function rotatePlan(x: number, z: number, angle: number): [number, number] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos + z * sin, -x * sin + z * cos]
}

function patchFromPolygon(
  points: THREE.Vector3[],
  owner: Pick<RoofUndersidePatch, 'ordinal' | 'roofId' | 'thickness'>,
): RoofUndersidePatch | null {
  // Least-degenerate plane through the polygon (Newell normal + centroid).
  const normal = new THREE.Vector3()
  const centroid = new THREE.Vector3()
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    normal.x += (current.y - next.y) * (current.z + next.z)
    normal.y += (current.z - next.z) * (current.x + next.x)
    normal.z += (current.x - next.x) * (current.y + next.y)
    centroid.add(current)
  }
  centroid.divideScalar(points.length)
  if (!(Math.abs(normal.y) > 1e-9)) return null
  const a = -normal.x / normal.y
  const b = -normal.z / normal.y
  const c = centroid.y - a * centroid.x - b * centroid.z
  const polygon = points.map((point) => [point.x, point.z] as [number, number])
  return {
    polygon,
    a,
    b,
    c,
    ...owner,
    minX: Math.min(...polygon.map((point) => point[0])),
    maxX: Math.max(...polygon.map((point) => point[0])),
    minZ: Math.min(...polygon.map((point) => point[1])),
    maxZ: Math.max(...polygon.map((point) => point[1])),
  }
}

/**
 * Roof underside patches of every roof, grouped by building, in building
 * space. Memoised on the immutable `nodes` record.
 */
export function getRoofUndersidePatches(
  nodes: Readonly<Record<string, AnyNode>>,
): Map<string | null, RoofUndersidePatch[]> {
  const memoized = patchMemo.get(nodes)
  if (memoized) return memoized
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const byBuilding = new Map<string | null, RoofUndersidePatch[]>()
  for (const node of Object.values(nodes)) {
    // Hidden roofs still count: visibility is presentation, the walls are physical.
    if (node?.type !== 'roof') continue
    const roof = node as RoofNode
    const levelId = resolveLevelId(roof, nodes as Record<string, AnyNode>)
    const level = elevations.get(levelId)
    if (!level) continue
    for (const childId of roof.children ?? []) {
      const segment = nodes[childId]
      if (segment?.type !== 'roof-segment') continue
      const polygons = getRoofSegmentUndersidePolygons(segment as RoofSegmentNode)
      if (!polygons) continue
      const seg = segment as RoofSegmentNode
      const { cosTheta } = getSegmentSlopeFrame(seg)
      const thickness =
        seg.deckThickness / Math.max(0.1, cosTheta) + seg.shingleThickness * cosTheta
      for (const polygon of polygons) {
        const points = polygon.map((point) => {
          const [sx, sz] = rotatePlan(point.x, point.z, seg.rotation ?? 0)
          const [rx, rz] = rotatePlan(
            seg.position[0] + sx,
            seg.position[2] + sz,
            roof.rotation ?? 0,
          )
          return new THREE.Vector3(
            roof.position[0] + rx,
            level.baseY + roof.position[1] + seg.position[1] + point.y,
            roof.position[2] + rz,
          )
        })
        const patch = patchFromPolygon(points, {
          ordinal: level.ordinal,
          roofId: roof.id,
          thickness,
        })
        if (!patch) continue
        const list = byBuilding.get(level.buildingId) ?? []
        list.push(patch)
        byBuilding.set(level.buildingId, list)
      }
    }
  }
  patchMemo.set(nodes, byBuilding)
  return byBuilding
}

export function pointInPolygon(x: number, z: number, polygon: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!
    const [xj, zj] = polygon[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

export function distanceToSegment(x: number, z: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const lengthSq = dx * dx + dz * dz
  const t =
    lengthSq > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSq)) : 0
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t))
}

export function patchHeight(patch: RoofUndersidePatch, x: number, z: number) {
  return patch.a * x + patch.b * z + patch.c
}

/**
 * The lowest roof underside above `base` at a plan point, skipping `except`.
 * Heights are in the patches' frame.
 */
export function capPatchAt(
  patches: readonly RoofUndersidePatch[],
  x: number,
  z: number,
  base: number,
  except?: RoofUndersidePatch,
) {
  let best: RoofUndersidePatch | null = null
  let bestHeight = Number.POSITIVE_INFINITY
  for (const patch of patches) {
    if (patch === except) continue
    if (x < patch.minX || x > patch.maxX || z < patch.minZ || z > patch.maxZ) continue
    if (!pointInPolygon(x, z, patch.polygon)) continue
    const height = patchHeight(patch, x, z)
    if (height > base + ROOF_CLEARANCE && height < bestHeight) {
      best = patch
      bestHeight = height
    }
  }
  return best ? { patch: best, height: bestHeight } : null
}

/** Patches of the building that holds `levelId`, heights relative to that level's floor. */
export function getLevelRoofPatches(
  nodes: Readonly<Record<string, AnyNode>>,
  levelId: string,
): {
  patches: RoofUndersidePatch[]
  level: { baseY: number; height: number; ordinal: number; buildingId: string | null }
} | null {
  const level = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>).get(levelId)
  if (!level) return null
  const candidates = getRoofUndersidePatches(nodes).get(level.buildingId)
  if (!candidates?.length) return null
  return { patches: candidates.map((patch) => ({ ...patch, c: patch.c - level.baseY })), level }
}

/** Plan parameter `t` on a→b where it crosses c→d, if the segments cross. */
export function segmentCrossing(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): number | null {
  const rx = b[0] - a[0]
  const rz = b[1] - a[1]
  const sx = d[0] - c[0]
  const sz = d[1] - c[1]
  const denominator = rx * sz - rz * sx
  if (Math.abs(denominator) < 1e-12) return null
  const qx = c[0] - a[0]
  const qz = c[1] - a[1]
  const t = (qx * sz - qz * sx) / denominator
  const u = (qx * rz - qz * rx) / denominator
  if (u < -1e-9 || u > 1 + 1e-9) return null
  return t
}

/**
 * Height a column reaches to meet the roof above it: the lowest roof underside
 * over the column's centre, above its base. A column under a roof is a post —
 * it is cut by a lower roof and stretched to a higher one, whatever its own
 * height. Null when no roof is over it (the column keeps its height).
 */
export function resolveColumnRoofHeight(
  column: Pick<ColumnNode, 'id' | 'parentId' | 'position' | 'type'>,
  nodes: Readonly<Record<string, AnyNode>>,
  /** Level-local Y the column stands on — its slab lift included. */
  base = column.position[1],
): number | null {
  const levelId = resolveLevelId(column as AnyNode, nodes as Record<string, AnyNode>)
  const cover = getLevelRoofPatches(nodes, levelId)
  if (!cover) return null
  const [x, , z] = column.position
  const cap = capPatchAt(cover.patches, x, z, base)
  return cap ? cap.height - base : null
}
