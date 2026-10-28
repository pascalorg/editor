import { type AnyNode, type AnyNodeId, traceFoundationOutlines } from '@pascal-app/core'

type P = [number, number]

/** How near the walls' outside faces a foundation corner or side snaps onto them, metres (~1 ft). */
export const WALL_FACE_SNAP = 0.3
/** A side within this sine of a face's line runs with it. */
const PARALLEL_SINE = 0.02

const facesMemo = new WeakMap<object, Map<string, P[][]>>()

/**
 * The outside faces of the walls over the foundation of `levelId`'s building, as the foundation
 * traces them (`traceFoundationOutlines`): closed loops, level-local plan. A drag reads one scene
 * from start to end, so they are worked out once a drag.
 */
export function wallFacesOf(nodes: Record<string, AnyNode>, levelId: string | null): P[][] {
  const level = levelId ? nodes[levelId] : undefined
  const buildingId = level?.type === 'level' ? level.parentId : null
  if (!buildingId) return []
  let byBuilding = facesMemo.get(nodes)
  const hit = byBuilding?.get(buildingId)
  if (hit) return hit
  const faces = traceFoundationOutlines(nodes as Record<AnyNodeId, AnyNode>, buildingId)
  if (!byBuilding) {
    byBuilding = new Map()
    facesMemo.set(nodes, byBuilding)
  }
  byBuilding.set(buildingId, faces)
  return faces
}

const sides = (loop: P[]) => loop.map((a, i) => [a, loop[(i + 1) % loop.length]!] as const)

/**
 * A foundation corner onto the walls' outside faces: a corner of them within `WALL_FACE_SNAP`, else
 * the nearest point of a face within half that. `null` off them.
 */
export function snapPointToWallFaces(faces: P[][], point: readonly [number, number]): P | null {
  let corner: P | null = null
  let cornerGap = WALL_FACE_SNAP
  for (const loop of faces)
    for (const vertex of loop) {
      const gap = Math.hypot(point[0] - vertex[0], point[1] - vertex[1])
      if (gap <= cornerGap) {
        corner = [vertex[0], vertex[1]]
        cornerGap = gap
      }
    }
  if (corner) return corner
  let onFace: P | null = null
  let faceGap = WALL_FACE_SNAP / 2
  for (const loop of faces)
    for (const [a, b] of sides(loop)) {
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const length2 = dx * dx + dy * dy
      if (length2 < 1e-12) continue
      const t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2
      if (t < 0 || t > 1) continue
      const near: P = [a[0] + dx * t, a[1] + dy * t]
      const gap = Math.hypot(point[0] - near[0], point[1] - near[1])
      if (gap <= faceGap) {
        onFace = near
        faceGap = gap
      }
    }
  return onFace
}

/**
 * A foundation side onto the walls' outside faces: moved square to itself onto the line of a face
 * it runs with and overlaps, when within `WALL_FACE_SNAP` of it. `null` off them.
 */
export function snapEdgeToWallFaces(
  faces: P[][],
  edge: readonly [readonly [number, number], readonly [number, number]],
): [P, P] | null {
  const [a, b] = edge
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) return null
  const u: P = [dx / length, dy / length]
  const n: P = [-u[1], u[0]]
  let best: number | null = null
  for (const loop of faces)
    for (const [p, q] of sides(loop)) {
      const fx = q[0] - p[0]
      const fy = q[1] - p[1]
      const faceLength = Math.hypot(fx, fy)
      if (faceLength < 1e-9 || Math.abs(u[0] * fy - u[1] * fx) / faceLength > PARALLEL_SINE)
        continue
      // Overlapping along the side, not a face further along its line.
      const s0 = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]
      const s1 = (q[0] - a[0]) * u[0] + (q[1] - a[1]) * u[1]
      if (Math.max(s0, s1) < 0 || Math.min(s0, s1) > length) continue
      const shift = (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1]
      if (Math.abs(shift) <= WALL_FACE_SNAP && (best === null || Math.abs(shift) < Math.abs(best)))
        best = shift
    }
  if (best === null) return null
  return [
    [a[0] + n[0] * best, a[1] + n[1] * best],
    [b[0] + n[0] * best, b[1] + n[1] * best],
  ]
}
