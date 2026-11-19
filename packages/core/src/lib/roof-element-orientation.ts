import { getBarrelRoofFaces } from '../schema/nodes/roof-glazing'
import {
  getSegmentSlopeFrame,
  ROOF_SHAPE_DEFAULTS,
  type RoofSegmentNode,
} from '../schema/nodes/roof-segment'

type Normal = [number, number, number]

function normal(x: number, y: number, z: number): Normal {
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

function slopeNormal(dx: number, dz: number, tan: number): Normal {
  return normal(dx * tan, 1, dz * tan)
}

/** Native accessory orientation, distinct from a physical covering triangle's normal. */
export function getRoofSegmentSurfaceNormal(seg: RoofSegmentNode, lx: number, lz: number): Normal {
  const { roofType, depth, width } = seg
  const slope = getSegmentSlopeFrame(seg)
  if (slope.activeRh === 0 || slope.tanTheta === 0) return [0, 1, 0]
  if (roofType === 'barrel') {
    const face = getBarrelRoofFaces(seg).find(
      (face) =>
        face.normal[1] > 0 &&
        (lz - face.origin[2]) / face.v[2] >= -1e-6 &&
        (lz - face.origin[2]) / face.v[2] <= face.length + 1e-6,
    )
    return face ? [...face.normal] : [0, 1, 0]
  }
  const primaryTan = slope.tanTheta
  const halfW = width / 2
  const halfD = depth / 2
  if (roofType === 'gable' || roofType === 'gambrel') {
    if (roofType === 'gambrel') {
      const lowerWidthRatio =
        seg.gambrelLowerWidthRatio ?? ROOF_SHAPE_DEFAULTS.gambrelLowerWidthRatio
      const lowerHeightRatio =
        seg.gambrelLowerHeightRatio ?? ROOF_SHAPE_DEFAULTS.gambrelLowerHeightRatio
      const mz = halfD * lowerWidthRatio
      if (Math.abs(lz) <= mz) {
        const upperRise = slope.activeRh * (1 - lowerHeightRatio)
        return slopeNormal(0, lz >= 0 ? 1 : -1, mz > 0 ? upperRise / mz : 0)
      }
    }
    return slopeNormal(0, lz >= 0 ? 1 : -1, primaryTan)
  }
  if (roofType === 'shed') return slopeNormal(0, 1, primaryTan)
  if (roofType === 'conical') {
    const radius = Math.hypot(lx, lz)
    return radius <= 1e-6 ? [0, 1, 0] : slopeNormal(lx / radius, lz / radius, primaryTan)
  }
  if (roofType === 'hip') {
    const onZ = (halfD > 0 ? Math.abs(lz) / halfD : 0) >= (halfW > 0 ? Math.abs(lx) / halfW : 0)
    return onZ
      ? slopeNormal(0, lz >= 0 ? 1 : -1, primaryTan)
      : slopeNormal(lx >= 0 ? 1 : -1, 0, primaryTan)
  }
  if (roofType === 'mansard') {
    const widthRatio = seg.mansardSteepWidthRatio ?? ROOF_SHAPE_DEFAULTS.mansardSteepWidthRatio
    const heightRatio = seg.mansardSteepHeightRatio ?? ROOF_SHAPE_DEFAULTS.mansardSteepHeightRatio
    const inset = Math.min(width, depth) * widthRatio
    const fx = halfW > 0 ? Math.abs(lx) / halfW : 0
    const fz = halfD > 0 ? Math.abs(lz) / halfD : 0
    const onZ = fz >= fx
    const inSteepBand = onZ ? Math.abs(lz) > halfD - inset : Math.abs(lx) > halfW - inset
    let tan = primaryTan
    if (!inSteepBand) {
      const topRise = slope.activeRh * (1 - heightRatio)
      const topRun = Math.max(0, Math.min(halfW, halfD) - inset)
      tan = topRun > 0 ? topRise / topRun : 0
    }
    return onZ ? slopeNormal(0, lz >= 0 ? 1 : -1, tan) : slopeNormal(lx >= 0 ? 1 : -1, 0, tan)
  }
  if (roofType === 'dutch') {
    const inset =
      Math.min(width, depth) * (seg.dutchHipWidthRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipWidthRatio)
    const heightRatio = seg.dutchHipHeightRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipHeightRatio
    const lengthRatio = seg.dutchWaistLengthRatio ?? ROOF_SHAPE_DEFAULTS.dutchWaistLengthRatio
    const lowerRise = slope.activeRh * heightRatio
    const waistHalfX = Math.max(0, (halfW - inset) * (width >= depth ? lengthRatio : 1))
    const waistHalfZ = Math.max(0, (halfD - inset) * (width >= depth ? 1 : lengthRatio))
    if (Math.abs(lx) <= waistHalfX && Math.abs(lz) <= waistHalfZ) {
      const topRise = slope.activeRh * (1 - heightRatio)
      if (width >= depth) {
        return slopeNormal(0, lz >= 0 ? 1 : -1, waistHalfZ > 0 ? topRise / waistHalfZ : 0)
      }
      return slopeNormal(lx >= 0 ? 1 : -1, 0, waistHalfX > 0 ? topRise / waistHalfX : 0)
    }
    const xRun = Math.max(0.0001, halfW - waistHalfX)
    const zRun = Math.max(0.0001, halfD - waistHalfZ)
    const xTan = Math.abs(lx) > waistHalfX ? lowerRise / xRun : 0
    const zTan = Math.abs(lz) > waistHalfZ ? lowerRise / zRun : 0
    return normal((lx >= 0 ? 1 : -1) * xTan, 1, (lz >= 0 ? 1 : -1) * zTan)
  }
  return [0, 1, 0]
}

/** Yaw in the native +X-projected surface basis used by accessory renderers. */
export function getRoofSegmentDownSlopeYaw(seg: RoofSegmentNode, lx: number, lz: number): number {
  const [x, y, z] = getRoofSegmentSurfaceNormal(seg, lx, lz)
  return x === 0 && z === 0 ? 0 : Math.atan2(x * y, z)
}
