import {
  DEFAULT_SLAB_ELEVATION,
  MAX_SLAB_SLOPE_DEGREES,
  type SlabNode,
  type SlabSlope,
} from '../../schema/nodes/slab'

const SLOPE_PITCH_EPSILON = 1e-6

export type SlabSlopeInput = Pick<
  SlabNode,
  | 'polygon'
  | 'elevation'
  | 'thickness'
  | 'slope'
  | 'recessed'
  | 'plateRole'
  | 'autoFromWalls'
  | 'boundary'
>

export type SlabSlopePlane = {
  sloped: boolean
  dirX: number
  dirZ: number
  grade: number
  minProj: number
  maxProj: number
  span: number
  rise: number
  minTop: number
  maxTop: number
}

export function normalizeSlabSlopeDirection(direction: number): number {
  if (!Number.isFinite(direction)) return 0
  return ((direction % 360) + 360) % 360
}

export function slabSlopeEqual(a: SlabSlope | undefined, b: SlabSlope | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.direction === b.direction && a.pitch === b.pitch
}

/**
 * Whether a slab carries an active planar slope. Recessed shells (pools) and
 * reconciler-owned floor plates stay flat.
 */
export function hasSlabSlope(
  slab: Pick<SlabNode, 'slope' | 'recessed' | 'plateRole' | 'autoFromWalls' | 'boundary'>,
): boolean {
  if (slab.recessed || slab.plateRole === 'base' || slab.autoFromWalls || slab.boundary === 'auto')
    return false
  const pitch = slab.slope?.pitch
  return typeof pitch === 'number' && Number.isFinite(pitch) && pitch > SLOPE_PITCH_EPSILON
}

/**
 * Planar slope frame anchored at the lowest projection of the stored slab
 * polygon along the uphill direction. `slab.elevation` is therefore always the
 * low-end walking surface, and every point on the stored polygon sits at
 * `elevation + (dot(p, dir) - minProj) * tan(pitch)`.
 */
export function getSlabSlopePlane(slab: SlabSlopeInput): SlabSlopePlane {
  const minTop = slab.elevation ?? DEFAULT_SLAB_ELEVATION
  if (!hasSlabSlope(slab) || slab.polygon.length < 3) {
    return {
      sloped: false,
      dirX: 1,
      dirZ: 0,
      grade: 0,
      minProj: 0,
      maxProj: 0,
      span: 0,
      rise: 0,
      minTop,
      maxTop: minTop,
    }
  }

  const pitch = Math.min(Math.max(slab.slope!.pitch, 0), MAX_SLAB_SLOPE_DEGREES)
  const dirRad = ((slab.slope!.direction ?? 0) * Math.PI) / 180
  const dirX = Math.cos(dirRad)
  const dirZ = Math.sin(dirRad)
  const grade = Math.tan((pitch * Math.PI) / 180)

  let minProj = Number.POSITIVE_INFINITY
  let maxProj = Number.NEGATIVE_INFINITY
  for (const [x, z] of slab.polygon) {
    const proj = x * dirX + z * dirZ
    if (proj < minProj) minProj = proj
    if (proj > maxProj) maxProj = proj
  }

  const span = Math.max(0, maxProj - minProj)
  const rise = span * grade
  return {
    sloped: true,
    dirX,
    dirZ,
    grade,
    minProj,
    maxProj,
    span,
    rise,
    minTop,
    maxTop: minTop + rise,
  }
}

export function getSlabElevationAtPoint(slab: SlabSlopeInput, x: number, z: number): number {
  const plane = getSlabSlopePlane(slab)
  if (!plane.sloped) return plane.minTop
  return plane.minTop + (x * plane.dirX + z * plane.dirZ - plane.minProj) * plane.grade
}

export function getSlabBottomElevationAtPoint(slab: SlabSlopeInput, x: number, z: number): number {
  return getSlabElevationAtPoint(slab, x, z) - (slab.thickness ?? 0.05)
}

export function getSlabMaxElevation(slab: SlabSlopeInput): number {
  return getSlabSlopePlane(slab).maxTop
}

export function getSlabSurfaceNormal(slab: SlabSlopeInput): [number, number, number] {
  const plane = getSlabSlopePlane(slab)
  if (!plane.sloped) return [0, 1, 0]
  const nx = -plane.dirX * plane.grade
  const nz = -plane.dirZ * plane.grade
  const invLen = 1 / Math.hypot(nx, 1, nz)
  return [nx * invLen, invLen, nz * invLen]
}

export type SlabPlaneRayHit = {
  t: number
  x: number
  y: number
  z: number
}

/**
 * Exact intersection of a forward ray (`t > 0`) with the slab's walking-surface
 * plane. Reduces identically to `(elevation - oy) / dy` when the slab is flat.
 */
export function intersectRayWithSlabPlane(
  slab: SlabSlopeInput,
  rayOrigin: readonly [number, number, number],
  rayDirection: readonly [number, number, number],
): SlabPlaneRayHit | null {
  const [ox, oy, oz] = rayOrigin
  const [dx, dy, dz] = rayDirection
  const plane = getSlabSlopePlane(slab)
  if (!plane.sloped) {
    if (Math.abs(dy) < 1e-9) return null
    const t = (plane.minTop - oy) / dy
    if (t <= 0) return null
    return { t, x: ox + dx * t, y: plane.minTop, z: oz + dz * t }
  }

  const gx = plane.dirX * plane.grade
  const gz = plane.dirZ * plane.grade
  const denom = dy - gx * dx - gz * dz
  if (Math.abs(denom) < 1e-9) return null
  const planeYAtOrigin =
    plane.minTop + (ox * plane.dirX + oz * plane.dirZ - plane.minProj) * plane.grade
  const t = (planeYAtOrigin - oy) / denom
  if (t <= 0) return null
  const x = ox + dx * t
  const z = oz + dz * t
  const y = plane.minTop + (x * plane.dirX + z * plane.dirZ - plane.minProj) * plane.grade
  return { t, x, y, z }
}
