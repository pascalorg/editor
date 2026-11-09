import {
  getWallArcData,
  getWallChordFrame,
  getWallFaceOffsets,
  type WallFace,
  type WallFaceRegion,
  type WallNode,
} from '@pascal-app/core'
import { Matrix4, Quaternion, Vector3 } from 'three'
import type { WallRegionBounds } from './paint-regions'

// Geometry for editing a selected wall's paint regions in place. Everything is
// in the wall mesh's local frame: x along the chord from the start (= region
// `u`), y up from the wall base, z toward the reference line's left (face a).
// A region's `v` is measured above its face's own base, so callers pass the
// face base as `baseAt(u)`.

export const REGION_MIN_SIZE = 0.02
export const REGION_EDGE_SNAP_TOLERANCE = 0.08
const EDGE_EPSILON = 1e-4

export type RegionEdge = 'u0' | 'u1' | 'v0' | 'v1'
export const REGION_EDGES: readonly RegionEdge[] = ['u0', 'u1', 'v0', 'v1']

export type WallFaceSurface =
  | { kind: 'plane'; face: WallFace; length: number; z: number }
  | {
      kind: 'arc'
      face: WallFace
      length: number
      cx: number
      cz: number
      radius: number
      direction: number
    }

type WallSurfaceInput = Pick<
  WallNode,
  'start' | 'end' | 'curveOffset' | 'thickness' | 'justification'
>

/** The face's surface in wall-local coordinates: a vertical plane or a vertical cylinder. */
export function getWallFaceSurface(wall: WallSurfaceInput, face: WallFace): WallFaceSurface {
  const chord = getWallChordFrame(wall)
  const offset = getWallFaceOffsets(wall)[face]
  const arc = getWallArcData(wall)
  if (!arc) return { kind: 'plane', face, length: chord.length, z: offset }
  const dx = arc.center.x - chord.start.x
  const dy = arc.center.y - chord.start.y
  // Left of a counter-clockwise arc points at its centre, so an offset toward
  // the left shrinks the radius there.
  return {
    kind: 'arc',
    face,
    length: chord.length,
    cx: dx * chord.tangent.x + dy * chord.tangent.y,
    cz: dx * chord.normal.x + dy * chord.normal.y,
    radius: Math.max(1e-6, arc.radius - arc.direction * offset),
    direction: arc.direction,
  }
}

const Y_AXIS = new Vector3(0, 1, 0)
const UNIT_SCALE = new Vector3(1, 1, 1)

/** Wall-local → parent (level) matrix, the transform the wall mesh renders with. */
export function wallLocalMatrix(
  wall: Pick<WallNode, 'start' | 'end'>,
  baseElevation: number,
  target = new Matrix4(),
): Matrix4 {
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  return target.compose(
    new Vector3(wall.start[0], baseElevation, wall.start[1]),
    new Quaternion().setFromAxisAngle(Y_AXIS, -angle),
    UNIT_SCALE,
  )
}

export type FaceSurfacePoint = {
  x: number
  z: number
  /** Outward normal of this face, wall-local XZ. */
  nx: number
  nz: number
  /** Unit tangent toward increasing u, wall-local XZ. */
  tx: number
  tz: number
}

/** The point on the face above chord station `u`, with its outward normal and tangent. */
export function faceSurfacePoint(surface: WallFaceSurface, u: number): FaceSurfacePoint {
  const outward = surface.face === 'a' ? 1 : -1
  if (surface.kind === 'plane') {
    return { x: u, z: surface.z, nx: 0, nz: outward, tx: 1, tz: 0 }
  }
  const du = u - surface.cx
  const root = Math.sqrt(Math.max(0, surface.radius * surface.radius - du * du))
  const z = surface.cz - surface.direction * root
  // Left normal of the curve: toward the centre on a counter-clockwise arc.
  const lx = (surface.direction * (surface.cx - u)) / surface.radius
  const lz = (surface.direction * (surface.cz - z)) / surface.radius
  const length = Math.hypot(lx, lz) || 1
  const nx = (lx / length) * outward
  const nz = (lz / length) * outward
  return { x: u, z, nx, nz, tx: lz / length, tz: -lx / length }
}

type Vec3 = { x: number; y: number; z: number }

/**
 * Where a wall-local ray meets the face: `u` along the chord and local `y`.
 * Null when the ray runs parallel to the face or misses it.
 */
export function intersectFaceSurface(
  surface: WallFaceSurface,
  origin: Vec3,
  direction: Vec3,
): { u: number; y: number } | null {
  if (surface.kind === 'plane') {
    if (Math.abs(direction.z) < 1e-9) return null
    const t = (surface.z - origin.z) / direction.z
    if (!(t >= 0)) return null
    return { u: origin.x + direction.x * t, y: origin.y + direction.y * t }
  }
  const ox = origin.x - surface.cx
  const oz = origin.z - surface.cz
  const a = direction.x * direction.x + direction.z * direction.z
  if (a < 1e-12) return null
  const b = 2 * (ox * direction.x + oz * direction.z)
  const c = ox * ox + oz * oz - surface.radius * surface.radius
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null
  const root = Math.sqrt(discriminant)
  for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
    if (t < 0) continue
    const z = origin.z + direction.z * t
    // Only the branch the wall bulges along is the face.
    if ((z - surface.cz) * -surface.direction < -1e-9) continue
    return { u: origin.x + direction.x * t, y: origin.y + direction.y * t }
  }
  return null
}

export type ResolvedRegionBounds = { u0: number; u1: number; v0: number; v1: number }

/** Region bounds with absent edges resolved to the face's edges. */
export function resolveRegionBounds(
  region: Pick<WallFaceRegion, 'u0' | 'u1' | 'v0' | 'v1'>,
  length: number,
  faceHeight: number,
): ResolvedRegionBounds {
  return {
    u0: Math.max(0, region.u0 ?? 0),
    u1: Math.min(length, region.u1 ?? length),
    v0: Math.max(0, region.v0 ?? 0),
    v1: Math.min(faceHeight, region.v1 ?? faceHeight),
  }
}

export function regionBoundsOf(region: WallFaceRegion): WallRegionBounds {
  const bounds: WallRegionBounds = {}
  for (const edge of REGION_EDGES) if (region[edge] !== undefined) bounds[edge] = region[edge]
  return bounds
}

export type RegionBoundDragInput = {
  region: WallFaceRegion
  edge: RegionEdge
  /** Unsnapped pointer value for the edge: metres along (u) or above the face base (v). */
  raw: number
  length: number
  faceHeight: number
  gridStep?: number | null
  /** Openings' and other regions' bounds on this face (`wallRegionSnapTargets`); face edges are always targets. */
  snapTargets?: readonly number[]
  edgeSnap?: boolean
  snapTolerance?: number
}

/**
 * The region's bounds after dragging one edge. Snaps to the grid, then (when
 * edge snapping is on) to the face edges and other regions within tolerance;
 * clamps so the region keeps REGION_MIN_SIZE and stays on the face. An edge
 * dragged onto the face edge becomes absent, so it follows the wall.
 */
export function resolveRegionBoundDrag(input: RegionBoundDragInput): WallRegionBounds {
  const { region, edge, raw, length, faceHeight } = input
  const isU = edge[0] === 'u'
  const extent = isU ? length : faceHeight
  let value = raw
  if (input.gridStep && input.gridStep > 0)
    value = Math.round(raw / input.gridStep) * input.gridStep
  if (input.edgeSnap) {
    const tolerance = input.snapTolerance ?? REGION_EDGE_SNAP_TOLERANCE
    let best: number | null = null
    for (const target of [0, extent, ...(input.snapTargets ?? [])]) {
      const distance = Math.abs(target - raw)
      if (distance <= tolerance && (best === null || distance < Math.abs(best - raw))) {
        best = target
      }
    }
    if (best !== null) value = best
  }

  const current = resolveRegionBounds(region, length, faceHeight)
  const low = edge === 'u0' || edge === 'v0'
  const other = current[isU ? (low ? 'u1' : 'u0') : low ? 'v1' : 'v0']
  const min = low ? 0 : Math.min(extent, other + REGION_MIN_SIZE)
  const max = low ? Math.max(0, other - REGION_MIN_SIZE) : extent
  value = Math.min(max, Math.max(min, value))

  const bounds = regionBoundsOf(region)
  const atFaceEdge = low ? value <= EDGE_EPSILON : value >= extent - EDGE_EPSILON
  if (atFaceEdge) delete bounds[edge]
  else bounds[edge] = value
  return bounds
}

/** The region list with one region's bounds replaced (absent = to the edge). */
export function withRegionBounds(
  regions: readonly WallFaceRegion[],
  regionId: string,
  bounds: WallRegionBounds,
): WallFaceRegion[] {
  return regions.map((region) => {
    if (region.id !== regionId) return region
    const { u0: _u0, u1: _u1, v0: _v0, v1: _v1, ...rest } = region
    const next: WallFaceRegion = { ...rest }
    for (const edge of REGION_EDGES) if (bounds[edge] !== undefined) next[edge] = bounds[edge]
    return next
  })
}

export type RegionHandlePlacement = {
  edge: RegionEdge
  position: [number, number, number]
  /** Yaw turning local +x onto the face tangent. */
  yaw: number
  /** Direction the handle points in the face plane: 0 = +u, π/2 = up. */
  tipAngle: number
}

const TIP_ANGLE: Record<RegionEdge, number> = {
  u0: Math.PI,
  u1: 0,
  v0: -Math.PI / 2,
  v1: Math.PI / 2,
}

function yawOf(point: FaceSurfacePoint) {
  return Math.atan2(-point.tz, point.tx)
}

/**
 * One handle per bounded edge: u edges at the region's mid-height, v edges at
 * its mid-width, lifted `lift` off the face. `keep` holds an edge that is
 * being dragged, so its handle survives being dragged onto the face edge.
 */
export function regionHandlePlacements(
  surface: WallFaceSurface,
  region: WallFaceRegion,
  faceHeight: number,
  baseAt: (u: number) => number,
  keep: RegionEdge | null = null,
  lift = 0.01,
): RegionHandlePlacement[] {
  const bounds = resolveRegionBounds(region, surface.length, faceHeight)
  const midU = (bounds.u0 + bounds.u1) / 2
  const midV = (bounds.v0 + bounds.v1) / 2
  const placements: RegionHandlePlacement[] = []
  for (const edge of REGION_EDGES) {
    if (region[edge] === undefined && edge !== keep) continue
    const u = edge === 'u0' ? bounds.u0 : edge === 'u1' ? bounds.u1 : midU
    const v = edge === 'v0' ? bounds.v0 : edge === 'v1' ? bounds.v1 : midV
    const point = faceSurfacePoint(surface, u)
    placements.push({
      edge,
      position: [point.x + point.nx * lift, baseAt(u) + v, point.z + point.nz * lift],
      yaw: yawOf(point),
      tipAngle: TIP_ANGLE[edge],
    })
  }
  return placements
}

export type OutlinePoint = { position: [number, number, number]; normal: [number, number] }

/** Closed outline of a region on its face (counter-clockwise seen from outside), lifted off it. */
export function regionOutline(
  surface: WallFaceSurface,
  region: WallFaceRegion,
  faceHeight: number,
  baseAt: (u: number) => number,
  lift = 0.004,
): OutlinePoint[] {
  const bounds = resolveRegionBounds(region, surface.length, faceHeight)
  const width = bounds.u1 - bounds.u0
  const segments = surface.kind === 'arc' ? Math.min(48, Math.max(2, Math.ceil(width / 0.2))) : 1
  const at = (u: number, v: number): OutlinePoint => {
    const point = faceSurfacePoint(surface, u)
    return {
      position: [point.x + point.nx * lift, baseAt(u) + v, point.z + point.nz * lift],
      normal: [point.nx, point.nz],
    }
  }
  const stations = Array.from(
    { length: segments + 1 },
    (_, index) => bounds.u0 + (width * index) / segments,
  )
  return [
    ...stations.map((u) => at(u, bounds.v0)),
    ...stations.reverse().map((u) => at(u, bounds.v1)),
  ]
}

/**
 * Triangles for a ribbon of half-width `halfWidth` running along a closed
 * outline, lying in the face. Each segment is extended by the half-width so
 * corners close.
 */
export function buildOutlineRibbon(
  points: readonly OutlinePoint[],
  halfWidth: number,
): Float32Array {
  const out: number[] = []
  const count = points.length
  for (let index = 0; index < count; index += 1) {
    const a = points[index]!
    const b = points[(index + 1) % count]!
    const dx = b.position[0] - a.position[0]
    const dy = b.position[1] - a.position[1]
    const dz = b.position[2] - a.position[2]
    const length = Math.hypot(dx, dy, dz)
    if (length < 1e-9) continue
    const ux = dx / length
    const uy = dy / length
    const uz = dz / length
    const nx = (a.normal[0] + b.normal[0]) / 2
    const nz = (a.normal[1] + b.normal[1]) / 2
    // In-face perpendicular: normal × direction.
    let wx = -nz * uy
    let wy = nz * ux - nx * uz
    let wz = nx * uy
    const wLength = Math.hypot(wx, wy, wz) || 1
    wx = (wx / wLength) * halfWidth
    wy = (wy / wLength) * halfWidth
    wz = (wz / wLength) * halfWidth
    const p0 = [
      a.position[0] - ux * halfWidth,
      a.position[1] - uy * halfWidth,
      a.position[2] - uz * halfWidth,
    ]
    const p1 = [
      b.position[0] + ux * halfWidth,
      b.position[1] + uy * halfWidth,
      b.position[2] + uz * halfWidth,
    ]
    const q = [
      [p0[0]! - wx, p0[1]! - wy, p0[2]! - wz],
      [p0[0]! + wx, p0[1]! + wy, p0[2]! + wz],
      [p1[0]! + wx, p1[1]! + wy, p1[2]! + wz],
      [p1[0]! - wx, p1[1]! - wy, p1[2]! - wz],
    ]
    for (const corner of [0, 1, 2, 0, 2, 3]) out.push(...q[corner]!)
  }
  return new Float32Array(out)
}
