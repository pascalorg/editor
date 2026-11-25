/**
 * Pure planar slope and linear grade math for heightfield terrain.
 *
 * Uses the same plan azimuth convention as sloped slabs (`0° = +X`, `90° = +Z`,
 * `180° = -X`, `270° = -Z`), where `direction` points uphill and `pitch` is the
 * inclination angle in degrees (`0..45°`).
 *
 * Pure data — no Three.js, per the core layer rule.
 */

import { quantize, type TerrainField } from './terrain-field'

export const MAX_TERRAIN_SLOPE_PITCH = 45

export type TerrainSlopeAnchor = 'center' | 'low-edge'

export type TerrainSlopeSpec = {
  /** Inclination angle in degrees (`0..45`). */
  readonly pitch: number
  /** Uphill azimuth in degrees (`0 = +X`, `90 = +Z`). */
  readonly direction: number
  /** Elevation in metres at the resolved anchor (`center` or `low-edge`). */
  readonly baseElevation: number
  /** Where `baseElevation` is pinned on the lot polygon. Defaults to `center`. */
  readonly anchor?: TerrainSlopeAnchor
}

export type TerrainSlopePlane = {
  readonly anchorX: number
  readonly anchorZ: number
  readonly anchorY: number
  /** Uphill azimuth in degrees (`0 = +X`, `90 = +Z`). */
  readonly direction: number
  /** Inclination angle in degrees (`0..45`). */
  readonly pitch: number
}

/** Precomputed linear coefficients `y = anchorY + (x - anchorX) * slopeX + (z - anchorZ) * slopeZ`. */
export type CompiledTerrainSlopePlane = {
  readonly anchorX: number
  readonly anchorZ: number
  readonly anchorY: number
  readonly slopeX: number
  readonly slopeZ: number
}

export type TerrainSlopePoint = readonly [x: number, z: number, y: number]

export type DerivedTerrainSlope = {
  readonly pitch: number
  readonly direction: number
  readonly anchor: [number, number, number]
  readonly horizontalDistance: number
  readonly verticalDelta: number
  readonly clamped: boolean
}

export const DEFAULT_TERRAIN_SLOPE_SPEC: TerrainSlopeSpec = {
  pitch: 5,
  direction: 0,
  baseElevation: 0,
  anchor: 'center',
}

/** Clamp pitch to `[0, MAX_TERRAIN_SLOPE_PITCH]`, guarding against NaN/Infinity. */
export function clampTerrainSlopePitch(pitch: number): number {
  if (!Number.isFinite(pitch) || pitch <= 0) return 0
  return Math.min(MAX_TERRAIN_SLOPE_PITCH, pitch)
}

/** Wrap azimuth degrees cleanly into `[0, 360)`. */
export function normalizeTerrainSlopeDirection(direction: number): number {
  if (!Number.isFinite(direction)) return 0
  const wrapped = ((direction % 360) + 360) % 360
  return wrapped === 360 || Object.is(wrapped, -0) ? 0 : wrapped
}

/** Unit vector in XZ pointing uphill along `direction` degrees. */
export function terrainSlopeDirectionVector(direction: number): { dx: number; dz: number } {
  const rad = (normalizeTerrainSlopeDirection(direction) * Math.PI) / 180
  return { dx: Math.cos(rad), dz: Math.sin(rad) }
}

/** Grade percentage (`rise / run * 100`) for a pitch in degrees. */
export function terrainSlopeGradePercent(pitch: number): number {
  const clamped = clampTerrainSlopePitch(pitch)
  if (clamped === 0) return 0
  return Math.tan((clamped * Math.PI) / 180) * 100
}

/**
 * Compile a `TerrainSlopePlane` into linear coefficients so inner heightfield
 * and brush loops evaluate each sample with two multiplies instead of trig.
 */
export function compileTerrainSlopePlane(plane: TerrainSlopePlane): CompiledTerrainSlopePlane {
  const anchorX = Number.isFinite(plane.anchorX) ? plane.anchorX : 0
  const anchorZ = Number.isFinite(plane.anchorZ) ? plane.anchorZ : 0
  const anchorY = Number.isFinite(plane.anchorY) ? plane.anchorY : 0
  const pitch = clampTerrainSlopePitch(plane.pitch)
  if (pitch === 0) {
    return { anchorX, anchorZ, anchorY, slopeX: 0, slopeZ: 0 }
  }
  const { dx, dz } = terrainSlopeDirectionVector(plane.direction)
  const tanPitch = Math.tan((pitch * Math.PI) / 180)
  return {
    anchorX,
    anchorZ,
    anchorY,
    slopeX: dx * tanPitch,
    slopeZ: dz * tanPitch,
  }
}

/** Evaluate a compiled planar terrain slope at world `(x, z)` in metres. */
export function evaluateCompiledTerrainSlopePlane(
  compiled: CompiledTerrainSlopePlane,
  x: number,
  z: number,
): number {
  return (
    compiled.anchorY +
    (x - compiled.anchorX) * compiled.slopeX +
    (z - compiled.anchorZ) * compiled.slopeZ
  )
}

/** Evaluate a planar terrain slope at world `(x, z)` in metres. */
export function evaluateTerrainSlopePlane(plane: TerrainSlopePlane, x: number, z: number): number {
  return evaluateCompiledTerrainSlopePlane(compileTerrainSlopePlane(plane), x, z)
}

function resolveLotAnchorXZ(
  polygon: ReadonlyArray<readonly [number, number]>,
  direction: number,
  anchor: TerrainSlopeAnchor,
): { anchorX: number; anchorZ: number } {
  if (anchor === 'low-edge') {
    const { dx, dz } = terrainSlopeDirectionVector(direction)
    let minProj = Number.POSITIVE_INFINITY
    for (const [x, z] of polygon) {
      if (!(Number.isFinite(x) && Number.isFinite(z))) continue
      const proj = x * dx + z * dz
      if (proj < minProj) minProj = proj
    }
    if (!Number.isFinite(minProj)) return { anchorX: 0, anchorZ: 0 }
    return { anchorX: minProj * dx, anchorZ: minProj * dz }
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of polygon) {
    if (!(Number.isFinite(x) && Number.isFinite(z))) continue
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  if (
    !(
      Number.isFinite(minX) &&
      Number.isFinite(maxX) &&
      Number.isFinite(minZ) &&
      Number.isFinite(maxZ)
    )
  ) {
    return { anchorX: 0, anchorZ: 0 }
  }
  return { anchorX: (minX + maxX) / 2, anchorZ: (minZ + maxZ) / 2 }
}

/**
 * Resolve a whole-lot `TerrainSlopeSpec` into an anchored plane over `polygon`.
 *
 * - `center` (default) pins `baseElevation` at the polygon bounding-box centre,
 *   matching the site datum convention used by USGS DEM lot imports (`y = 0` at
 *   lot centre so a centred building stays on grade).
 * - `low-edge` pins `baseElevation` at the lowest-projection vertex along the
 *   uphill vector, so the entire lot rises monotonically from `baseElevation`.
 */
export function resolveLotSlopePlane(
  polygon: ReadonlyArray<readonly [number, number]>,
  spec: TerrainSlopeSpec,
): TerrainSlopePlane {
  const pitch = clampTerrainSlopePitch(spec.pitch)
  const direction = normalizeTerrainSlopeDirection(spec.direction)
  const baseElevation = Number.isFinite(spec.baseElevation) ? spec.baseElevation : 0
  const anchor = spec.anchor ?? 'center'
  const { anchorX, anchorZ } = resolveLotAnchorXZ(polygon, direction, anchor)
  return { anchorX, anchorZ, anchorY: baseElevation, direction, pitch }
}

/**
 * Compute the `baseElevation` at the lot's chosen anchor (`center` or `low-edge`)
 * that makes `resolveLotSlopePlane` reproduce `plane` across the whole lot.
 */
export function terrainSlopeBaseElevationForPlane(
  polygon: ReadonlyArray<readonly [number, number]>,
  plane: TerrainSlopePlane,
  anchor: TerrainSlopeAnchor = 'center',
): number {
  const { anchorX, anchorZ } = resolveLotAnchorXZ(polygon, plane.direction, anchor)
  return evaluateTerrainSlopePlane(plane, anchorX, anchorZ)
}

/** Min/max elevation, total rise, and grade % across `polygon` for `spec`. */
export function terrainSlopeElevationRange(
  polygon: ReadonlyArray<readonly [number, number]>,
  spec: TerrainSlopeSpec,
): { min: number; max: number; rise: number; gradePercent: number } {
  const plane = resolveLotSlopePlane(polygon, spec)
  const compiled = compileTerrainSlopePlane(plane)
  const gradePercent = terrainSlopeGradePercent(plane.pitch)

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const [x, z] of polygon) {
    if (!(Number.isFinite(x) && Number.isFinite(z))) continue
    const y = evaluateCompiledTerrainSlopePlane(compiled, x, z)
    if (y < min) min = y
    if (y > max) max = y
  }
  if (!(Number.isFinite(min) && Number.isFinite(max))) {
    return { min: compiled.anchorY, max: compiled.anchorY, rise: 0, gradePercent }
  }
  return { min, max, rise: Math.max(0, max - min), gradePercent }
}

/**
 * Derive an exact planar slope passing through two 3D ground points `[x, z, y]`.
 *
 * Returns `null` when the two points coincide horizontally or contain non-finite
 * coordinates. The uphill direction automatically orients from the lower point
 * toward the higher point; pitch is clamped to `MAX_TERRAIN_SLOPE_PITCH`.
 */
export function deriveTerrainSlopeFromPoints(
  start: TerrainSlopePoint,
  end: TerrainSlopePoint,
): DerivedTerrainSlope | null {
  const [x1, z1, y1] = start
  const [x2, z2, y2] = end
  if (
    !(
      Number.isFinite(x1) &&
      Number.isFinite(z1) &&
      Number.isFinite(y1) &&
      Number.isFinite(x2) &&
      Number.isFinite(z2) &&
      Number.isFinite(y2)
    )
  ) {
    return null
  }

  const dx = x2 - x1
  const dz = z2 - z1
  const horizontalDistance = Math.hypot(dx, dz)
  if (horizontalDistance < 1e-4) return null

  const verticalDelta = y2 - y1
  if (Math.abs(verticalDelta) < 1e-4) {
    return {
      pitch: 0,
      direction: normalizeTerrainSlopeDirection((Math.atan2(dz, dx) * 180) / Math.PI),
      anchor: [x1, z1, y1],
      horizontalDistance,
      verticalDelta: 0,
      clamped: false,
    }
  }

  const uphillDx = verticalDelta >= 0 ? dx : -dx
  const uphillDz = verticalDelta >= 0 ? dz : -dz
  const direction = normalizeTerrainSlopeDirection((Math.atan2(uphillDz, uphillDx) * 180) / Math.PI)
  const rawPitch = (Math.atan2(Math.abs(verticalDelta), horizontalDistance) * 180) / Math.PI
  const pitch = clampTerrainSlopePitch(rawPitch)

  return {
    pitch,
    direction,
    anchor: [x1, z1, y1],
    horizontalDistance,
    verticalDelta,
    clamped: rawPitch > MAX_TERRAIN_SLOPE_PITCH,
  }
}

/**
 * Evaluate a planar slope across every sample of `field` (including its padded
 * margin outside `polygon` so the property boundary sits on continuous sloped
 * ground without a cliff).
 */
export function buildSlopedTerrainField(
  field: TerrainField,
  polygon: ReadonlyArray<readonly [number, number]>,
  spec: TerrainSlopeSpec,
): TerrainField {
  const compiled = compileTerrainSlopePlane(resolveLotSlopePlane(polygon, spec))
  const heights = new Int16Array(field.cols * field.rows)

  for (let row = 0; row < field.rows; row += 1) {
    const z = field.origin[1] + row * field.spacing
    const rowBase = row * field.cols
    const zTerm = compiled.anchorY + (z - compiled.anchorZ) * compiled.slopeZ
    for (let col = 0; col < field.cols; col += 1) {
      const x = field.origin[0] + col * field.spacing
      heights[rowBase + col] = quantize(field, zTerm + (x - compiled.anchorX) * compiled.slopeX)
    }
  }

  return { ...field, heights }
}
