import {
  calculateLevelMiters,
  getWallPlanFootprint,
  pointInPolygon2D,
  unionPolygons,
  type WallNode,
} from '@pascal-app/core'
import { create } from 'zustand'

export type RoofOutlineSnapChoice = 'grid' | 'building'

type RoofOutlineSnapState = {
  snap: RoofOutlineSnapChoice
  setSnap: (snap: RoofOutlineSnapChoice) => void
}

/**
 * What the points of a roof outline stick to: the grid, or the building's
 * outer contour — its outer wall corners and faces. Ephemeral UI state owned by
 * the kind, like `roof-footprint-source`.
 */
const useRoofOutlineSnap = create<RoofOutlineSnapState>((set) => ({
  snap: 'building',
  setSnap: (snap) => set({ snap }),
}))

export default useRoofOutlineSnap

type PlanPoint = [number, number]

function signedArea(ring: readonly PlanPoint[]) {
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i]!
    const [x1, z1] = ring[(i + 1) % ring.length]!
    area += x0 * z1 - x1 * z0
  }
  return area / 2
}

/**
 * Outer contours of a set of walls: the union of their footprints without the
 * holes — rooms are holes, so partitions never show up.
 */
export function buildingOutlines(walls: readonly WallNode[]): PlanPoint[][] {
  if (walls.length === 0) return []
  const miters = calculateLevelMiters([...walls])
  const footprints = walls
    .map((wall) =>
      getWallPlanFootprint(wall, miters).map((point) => [point.x, point.y] as PlanPoint),
    )
    .filter((footprint) => footprint.length >= 3)
  const rings = unionPolygons(footprints)
  return rings.filter(
    (ring, index) =>
      !rings.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          Math.abs(signedArea(other)) > Math.abs(signedArea(ring)) &&
          pointInPolygon2D(ring[0]!, other),
      ),
  )
}

// Metres: a point this close to an outer corner takes the corner, this close to
// an outer face lands on it. Wider than a grid step so a grid-snapped plan
// click still reaches the corner.
const CORNER_REACH = 0.75
const FACE_REACH = 0.5

export type OutlineSnap = {
  point: PlanPoint
  /** The outer face the point lies on, unless it took a corner. */
  face: [PlanPoint, PlanPoint] | null
}

/** The point stuck to the nearest outer corner, else the nearest outer face; null when neither is near. */
export function snapToBuildingOutline(
  point: PlanPoint,
  outlines: readonly PlanPoint[][],
): OutlineSnap | null {
  let corner: PlanPoint | null = null
  let cornerDistance = CORNER_REACH
  let face: OutlineSnap | null = null
  let faceDistance = FACE_REACH
  for (const ring of outlines) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % ring.length]!
      const toCorner = Math.hypot(point[0] - a[0], point[1] - a[1])
      if (toCorner < cornerDistance) {
        cornerDistance = toCorner
        corner = a
      }
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const lengthSq = dx * dx + dz * dz
      if (lengthSq < 1e-12) continue
      const t = Math.max(
        0,
        Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSq),
      )
      const onFace: PlanPoint = [a[0] + dx * t, a[1] + dz * t]
      const toFace = Math.hypot(point[0] - onFace[0], point[1] - onFace[1])
      if (toFace < faceDistance) {
        faceDistance = toFace
        face = { point: onFace, face: [a, b] }
      }
    }
  }
  return corner ? { point: corner, face: null } : face
}

// Within this angle of the wall's normal, a line leaving the middle of a wall
// is held square to it (radians).
const SQUARE_CAPTURE = (25 * Math.PI) / 180

/**
 * A line that leaves an outer wall mid-face heads across the building square
 * to that wall: while the cursor is within `SQUARE_CAPTURE` of the wall's
 * normal, the point slides on that normal and lands on the first outer face it
 * meets near the cursor. Null when the cursor heads elsewhere (along the wall).
 */
export function squareFromFace(
  from: PlanPoint,
  face: readonly [PlanPoint, PlanPoint],
  cursor: PlanPoint,
  outlines: readonly PlanPoint[][],
): OutlineSnap | null {
  const dx = face[1][0] - face[0][0]
  const dz = face[1][1] - face[0][1]
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return null
  let nx = -dz / length
  let nz = dx / length
  const vx = cursor[0] - from[0]
  const vz = cursor[1] - from[1]
  const along = vx * nx + vz * nz
  if (along < 0) {
    nx = -nx
    nz = -nz
  }
  const reach = Math.abs(along)
  if (reach < 1e-6 || Math.acos(Math.min(1, reach / Math.hypot(vx, vz))) > SQUARE_CAPTURE) {
    return null
  }
  const onRay: PlanPoint = [from[0] + nx * reach, from[1] + nz * reach]
  // The first outer face the ray meets, if the cursor is near it.
  let hit: OutlineSnap | null = null
  let hitT = Number.POSITIVE_INFINITY
  for (const ring of outlines) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % ring.length]!
      const ex = b[0] - a[0]
      const ez = b[1] - a[1]
      const denominator = nx * ez - nz * ex
      if (Math.abs(denominator) < 1e-9) continue
      const qx = a[0] - from[0]
      const qz = a[1] - from[1]
      const t = (qx * ez - qz * ex) / denominator
      const u = (qx * nz - qz * nx) / denominator
      if (t <= 1e-6 || u < 0 || u > 1 || t >= hitT) continue
      hitT = t
      hit = { point: [from[0] + nx * t, from[1] + nz * t], face: [a, b] }
    }
  }
  if (hit && Math.hypot(hit.point[0] - onRay[0], hit.point[1] - onRay[1]) < CORNER_REACH) return hit
  return { point: onRay, face: null }
}
