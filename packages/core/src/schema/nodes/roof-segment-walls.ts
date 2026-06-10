import type { RoofSegmentNode } from './roof-segment'
import { getSegmentSlopeFrame } from './roof-segment'

/**
 * Wall-face math for roof segments — the vertical surfaces a wall-mounted
 * opening (door / window) can attach to. A segment's generated volume has
 * four vertical faces; on gable-family roofs the end faces extend past the
 * eave line into the gable (rect + triangle/pentagon, coplanar with the
 * base wall). These helpers describe each face as a 2D frame
 * (`u` along the face, `v` height above the segment base) plus the
 * placeable profile polygon, so placement tools, renderers, and CSG cut
 * builders all share one definition of "the wall under the roof".
 *
 * The numbers MUST mirror the outer wall volume built by
 * `getRoofSegmentBrushes` in the viewer's roof system
 * (`getVol(wallThickness / 2, 0, 0, …)`): the volume is the segment
 * footprint extended outward by `wallThickness / 2`, which drops the eave
 * line by `(wallThickness / 2) · tanθ` and raises the ridge by the same
 * amount so the apex stays at `wallHeight + activeRh`.
 */

export type RoofWallFaceId = 'front' | 'back' | 'right' | 'left'

export type RoofSegmentWallFace = {
  id: RoofWallFaceId
  /** Outward normal in segment-local space. */
  normal: [number, number, number]
  /**
   * Yaw (radians, rotation-y) mapping opening-local +Z to the outward
   * normal and opening-local +X to the face's +U direction — the same
   * frame a wall-hosted door/window uses relative to its wall mesh.
   */
  yaw: number
  /** Face length along U. */
  length: number
  /**
   * Placeable region, CCW polygon in face coords. `u ∈ [0, length]`,
   * `v` is height above the segment base (segment-local Y).
   */
  profile: [number, number][]
}

type SegmentWallInputs = Pick<
  RoofSegmentNode,
  'roofType' | 'width' | 'depth' | 'wallHeight' | 'wallThickness' | 'pitch'
> &
  Partial<
    Pick<
      RoofSegmentNode,
      | 'gambrelLowerWidthRatio'
      | 'gambrelLowerHeightRatio'
      | 'mansardSteepWidthRatio'
      | 'mansardSteepHeightRatio'
      | 'dutchHipWidthRatio'
      | 'dutchHipHeightRatio'
    >
  >

type WallVolumeFrame = {
  /** Outer wall plane extents (footprint + wallThickness). */
  wV: number
  dV: number
  /** Eave height of the outer volume. */
  eaveY: number
  /** Ridge/peak height of the outer volume. */
  peakY: number
  /** tan(pitch) of the primary slope. */
  tanTheta: number
  hasSlope: boolean
}

function getWallVolumeFrame(node: SegmentWallInputs): WallVolumeFrame {
  const { activeRh, tanTheta } = getSegmentSlopeFrame(node)
  const wallThickness = node.wallThickness ?? 0.1
  const autoDrop = (wallThickness / 2) * tanTheta
  const wV = Math.max(0.01, node.width + wallThickness)
  const dV = Math.max(0.01, node.depth + wallThickness)
  const eaveY = Math.max(0.01, node.wallHeight - autoDrop)
  let rh = activeRh
  if (activeRh > 0) {
    rh = activeRh + autoDrop
    if (node.roofType === 'shed') rh = activeRh + 2 * autoDrop
  }
  return {
    wV,
    dV,
    eaveY,
    peakY: eaveY + Math.max(0.001, rh),
    tanTheta,
    hasSlope: activeRh > 0,
  }
}

const FACE_NORMALS: Record<RoofWallFaceId, [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
}

const FACE_YAWS: Record<RoofWallFaceId, number> = {
  front: 0,
  back: Math.PI,
  right: Math.PI / 2,
  left: -Math.PI / 2,
}

function rectProfile(length: number, top: number): [number, number][] {
  return [
    [0, 0],
    [length, 0],
    [length, top],
    [0, top],
  ]
}

function buildFaceProfile(
  node: SegmentWallInputs,
  frame: WallVolumeFrame,
  id: RoofWallFaceId,
): [number, number][] {
  const { wV, dV, eaveY, peakY, tanTheta, hasSlope } = frame
  const isEnd = id === 'right' || id === 'left'
  const length = isEnd ? dV : wV

  if (!hasSlope) return rectProfile(length, eaveY)

  switch (node.roofType) {
    case 'gable': {
      if (!isEnd) return rectProfile(length, eaveY)
      return [
        [0, 0],
        [length, 0],
        [length, eaveY],
        [length / 2, peakY],
        [0, eaveY],
      ]
    }
    case 'gambrel': {
      if (!isEnd) return rectProfile(length, eaveY)
      // Kink ring sits at z = ±mz on the nominal footprint (see
      // getModuleFaces); both end faces are symmetric about u = length/2.
      const ratio = node.gambrelLowerWidthRatio ?? 0.5
      const mz = Math.min((node.depth / 2) * ratio, length / 2)
      const kinkY = eaveY + (length / 2 - mz) * tanTheta
      return [
        [0, 0],
        [length, 0],
        [length, eaveY],
        [length / 2 + mz, kinkY],
        [length / 2, peakY],
        [length / 2 - mz, kinkY],
        [0, eaveY],
      ]
    }
    case 'shed': {
      // Slope falls toward +Z: 'back' is the full-height wall, the end
      // faces are right trapezoids rising toward the back edge.
      if (id === 'front') return rectProfile(length, eaveY)
      if (id === 'back') return rectProfile(length, peakY)
      if (id === 'right') {
        return [
          [0, 0],
          [length, 0],
          [length, peakY],
          [0, eaveY],
        ]
      }
      return [
        [0, 0],
        [length, 0],
        [length, eaveY],
        [0, peakY],
      ]
    }
    // hip / mansard / dutch slope on every side (dutch gablets are
    // recessed from the wall plane), so only the base rect is placeable.
    default:
      return rectProfile(length, eaveY)
  }
}

export function getRoofSegmentWallFace(
  node: SegmentWallInputs,
  id: RoofWallFaceId,
): RoofSegmentWallFace {
  const frame = getWallVolumeFrame(node)
  const isEnd = id === 'right' || id === 'left'
  return {
    id,
    normal: FACE_NORMALS[id],
    yaw: FACE_YAWS[id],
    length: isEnd ? frame.dV : frame.wV,
    profile: buildFaceProfile(node, frame, id),
  }
}

export function getRoofSegmentWallFaces(node: SegmentWallInputs): RoofSegmentWallFace[] {
  const frame = getWallVolumeFrame(node)
  return (['front', 'back', 'right', 'left'] as const).map((id) => ({
    id,
    normal: FACE_NORMALS[id],
    yaw: FACE_YAWS[id],
    length: id === 'right' || id === 'left' ? frame.dV : frame.wV,
    profile: buildFaceProfile(node, frame, id),
  }))
}

/**
 * Face coords → segment-local point on the outer wall plane. `inset`
 * pushes the point inward along the face normal — openings store their
 * center at the wall mid-plane (`inset = wallThickness / 2`) so the
 * frame assembly centers inside the wall like on a regular wall host.
 */
export function roofWallFaceLocalToSegment(
  node: SegmentWallInputs,
  id: RoofWallFaceId,
  u: number,
  v: number,
  inset = 0,
): [number, number, number] {
  const { wV, dV } = getWallVolumeFrame(node)
  switch (id) {
    case 'front':
      return [u - wV / 2, v, dV / 2 - inset]
    case 'back':
      return [wV / 2 - u, v, -dV / 2 + inset]
    case 'right':
      return [wV / 2 - inset, v, dV / 2 - u]
    case 'left':
      return [-wV / 2 + inset, v, u - dV / 2]
  }
}

/**
 * Segment-local point → face coords. `dist` is the signed offset off the
 * outer wall plane along the face normal (0 = on the plane, positive =
 * outside the volume).
 */
export function segmentPointToRoofWallFace(
  node: SegmentWallInputs,
  id: RoofWallFaceId,
  point: [number, number, number],
): { u: number; v: number; dist: number } {
  const { wV, dV } = getWallVolumeFrame(node)
  const [x, y, z] = point
  switch (id) {
    case 'front':
      return { u: x + wV / 2, v: y, dist: z - dV / 2 }
    case 'back':
      return { u: wV / 2 - x, v: y, dist: -z - dV / 2 }
    case 'right':
      return { u: dV / 2 - z, v: y, dist: x - wV / 2 }
    case 'left':
      return { u: z + dV / 2, v: y, dist: -x - wV / 2 }
  }
}

type FaceConstraint = {
  nu: number
  nv: number
  c: number
}

/**
 * Inward half-plane constraints of the raw profile polygon (CCW →
 * interior is to the left of each edge): a point p is inside when
 * `nu·p.u + nv·p.v ≥ c` for every constraint.
 */
function getProfileConstraints(face: RoofSegmentWallFace): FaceConstraint[] {
  const constraints: FaceConstraint[] = []
  const pts = face.profile
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    const du = b[0] - a[0]
    const dv = b[1] - a[1]
    const len = Math.hypot(du, dv)
    if (len < 1e-9) continue
    const nu = -dv / len
    const nv = du / len
    constraints.push({ nu, nv, c: nu * a[0] + nv * a[1] })
  }
  return constraints
}

/**
 * Half-plane constraints for the CENTER of a `width × height` rect that
 * must fit inside the face profile — the raw constraints eroded by the
 * rect's half-extents projected on each edge normal.
 */
function getRectCenterConstraints(
  face: RoofSegmentWallFace,
  width: number,
  height: number,
): FaceConstraint[] {
  return getProfileConstraints(face).map(({ nu, nv, c }) => ({
    nu,
    nv,
    c: c + (Math.abs(nu) * width) / 2 + (Math.abs(nv) * height) / 2,
  }))
}

/** Face id for an opening's stored yaw (`rotation[1]`), or null. */
export function getRoofWallFaceIdFromYaw(yaw: number): RoofWallFaceId | null {
  const tau = Math.PI * 2
  const normalized = ((yaw % tau) + tau) % tau
  const eps = 1e-3
  if (normalized < eps || tau - normalized < eps) return 'front'
  if (Math.abs(normalized - Math.PI) < eps) return 'back'
  if (Math.abs(normalized - Math.PI / 2) < eps) return 'right'
  if (Math.abs(normalized - (3 * Math.PI) / 2) < eps) return 'left'
  return null
}

/**
 * Max width of a rect growing from an anchored vertical edge (`anchorU`)
 * in direction `growSign` (±1 along U) while staying inside the face
 * profile at the fixed vertical center `vCenter`. Resize-handle limit:
 * the anchored-edge model matches the handles' apply math (opposite
 * edge stays put, center re-derives).
 */
export function getMaxRoofRectWidthFromAnchor(
  face: RoofSegmentWallFace,
  anchorU: number,
  growSign: number,
  vCenter: number,
  height: number,
): number {
  let max = Number.POSITIVE_INFINITY
  for (const { nu, nv, c } of getProfileConstraints(face)) {
    // Center at anchorU + growSign·w/2, eroded by |nu|·w/2 + |nv|·h/2:
    // base + k·w ≥ 0 with k ≤ 0 only when growth approaches the edge.
    const k = (nu * growSign - Math.abs(nu)) / 2
    if (k >= -1e-9) continue
    const base = nu * anchorU + nv * vCenter - c - (Math.abs(nv) * height) / 2
    max = Math.min(max, Math.max(0, base / -k))
  }
  return max
}

/**
 * Max height of a rect growing from an anchored horizontal edge
 * (`anchorV`) in direction `growSign` (+1 = bottom anchored, grows up)
 * while staying inside the face profile at the fixed horizontal center
 * `uCenter`.
 */
export function getMaxRoofRectHeightFromAnchor(
  face: RoofSegmentWallFace,
  uCenter: number,
  width: number,
  anchorV: number,
  growSign: number,
): number {
  let max = Number.POSITIVE_INFINITY
  for (const { nu, nv, c } of getProfileConstraints(face)) {
    const k = (nv * growSign - Math.abs(nv)) / 2
    if (k >= -1e-9) continue
    const base = nu * uCenter + nv * anchorV - c - (Math.abs(nu) * width) / 2
    max = Math.min(max, Math.max(0, base / -k))
  }
  return max
}

const CLAMP_EPSILON = 1e-4

/**
 * Clamp a rect center so the rect fits inside the face profile.
 *
 * - `lockV: true` (doors): `v` is fixed; only `u` slides. Returns null
 *   when no `u` keeps the rect inside at that height.
 * - otherwise (windows): the center is projected into the eroded convex
 *   region (cyclic projection — profiles are convex by construction).
 *
 * Returns null when the rect cannot fit anywhere on the face.
 */
export function clampRectToRoofWallFace(
  face: RoofSegmentWallFace,
  u: number,
  v: number,
  width: number,
  height: number,
  opts?: { lockV?: boolean },
): { u: number; v: number } | null {
  const constraints = getRectCenterConstraints(face, width, height)
  if (constraints.length < 3) return null

  if (opts?.lockV) {
    let lo = Number.NEGATIVE_INFINITY
    let hi = Number.POSITIVE_INFINITY
    for (const { nu, nv, c } of constraints) {
      const rhs = c - nv * v
      if (Math.abs(nu) < 1e-9) {
        if (rhs > CLAMP_EPSILON) return null
        continue
      }
      if (nu > 0) lo = Math.max(lo, rhs / nu)
      else hi = Math.min(hi, rhs / nu)
    }
    if (lo > hi + CLAMP_EPSILON) return null
    return { u: Math.min(Math.max(u, lo), hi), v }
  }

  let pu = u
  let pv = v
  for (let iter = 0; iter < 32; iter++) {
    let worst: FaceConstraint | null = null
    let worstViolation = CLAMP_EPSILON
    for (const constraint of constraints) {
      const violation = constraint.c - (constraint.nu * pu + constraint.nv * pv)
      if (violation > worstViolation) {
        worstViolation = violation
        worst = constraint
      }
    }
    if (!worst) return { u: pu, v: pv }
    pu += worst.nu * worstViolation
    pv += worst.nv * worstViolation
  }
  for (const { nu, nv, c } of constraints) {
    if (nu * pu + nv * pv < c - 1e-3) return null
  }
  return { u: pu, v: pv }
}
