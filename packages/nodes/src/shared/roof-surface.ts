import {
  getRoofSegmentSurfaceY,
  getSegmentSlopeFrame,
  ROOF_SHAPE_DEFAULTS,
  type RoofSegmentNode,
} from '@pascal-app/core'
import * as THREE from 'three'

// ─── Roof-surface helpers ────────────────────────────────────────────
// Analytical slope geometry for a roof segment, shared by every roof
// accessory that seats itself on the slope (solar-panel, skylight,
// box-vent). Lives here rather than inside any one kind's folder so the
// accessories don't reach across into a sibling kind for it.

export function getSurfaceY(lx: number, lz: number, seg: RoofSegmentNode): number {
  return getRoofSegmentSurfaceY(seg, lx, lz)
}

// Outward normal for a roof surface tilting at angle θ in the horizontal
// direction (dx, dz). Derivation: the surface tangent vectors are the
// ridge axis (perpendicular to the fall line, horizontal) and the
// down-slope direction (cos θ horizontal + −sin θ vertical). Crossing
// them gives the outward normal ∝ (sin θ · dx, cos θ, sin θ · dz),
// equivalently (dx · tan θ, 1, dz · tan θ) un-normalised.
function buildSlopeNormal(dx: number, dz: number, tan: number): THREE.Vector3 {
  return new THREE.Vector3(dx * tan, 1, dz * tan).normalize()
}

export function getAnalyticalNormal(lx: number, lz: number, seg: RoofSegmentNode): THREE.Vector3 {
  const { roofType, depth, width } = seg
  const slope = getSegmentSlopeFrame(seg)
  if (slope.activeRh === 0 || slope.tanTheta === 0) {
    return new THREE.Vector3(0, 1, 0)
  }
  const primaryTan = slope.tanTheta
  const halfW = width / 2
  const halfD = depth / 2

  // Ridge runs along X — slope falls in ±Z. Gambrel shares the gable
  // dispatch (its kink-to-eave/lower tier is the primary slope frame).
  if (roofType === 'gable' || roofType === 'gambrel') {
    if (roofType === 'gambrel') {
      // Tier-aware: the upper (shallower) face spans |z| < mz; the
      // lower (steep) face spans mz < |z| ≤ halfD. Using primaryTan on
      // the upper tier would tilt the ghost too steeply near the ridge.
      const lowerWidthRatio =
        seg.gambrelLowerWidthRatio ?? ROOF_SHAPE_DEFAULTS.gambrelLowerWidthRatio
      const lowerHeightRatio =
        seg.gambrelLowerHeightRatio ?? ROOF_SHAPE_DEFAULTS.gambrelLowerHeightRatio
      const mz = halfD * lowerWidthRatio
      if (Math.abs(lz) <= mz) {
        const upperRise = slope.activeRh * (1 - lowerHeightRatio)
        const upperRun = mz
        const upperTan = upperRun > 0 ? upperRise / upperRun : 0
        return buildSlopeNormal(0, lz >= 0 ? 1 : -1, upperTan)
      }
    }
    return buildSlopeNormal(0, lz >= 0 ? 1 : -1, primaryTan)
  }

  // Single slope falling toward +Z (ridge at -Z, eave at +Z).
  if (roofType === 'shed') {
    return buildSlopeNormal(0, 1, primaryTan)
  }

  // 4-sided slopes: the dominant axis chooses which face the point sits
  // on. Hip is uniform across all four faces. Mansard has a steep outer
  // band (primaryTan) and a shallow top inside the waist. Dutch has hip
  // ends and gable sides — both share the same primaryTan from the
  // slope frame, so directional dispatch is enough.
  if (roofType === 'hip') {
    const fx = halfW > 0 ? Math.abs(lx) / halfW : 0
    const fz = halfD > 0 ? Math.abs(lz) / halfD : 0
    if (fz >= fx) return buildSlopeNormal(0, lz >= 0 ? 1 : -1, primaryTan)
    return buildSlopeNormal(lx >= 0 ? 1 : -1, 0, primaryTan)
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
      // Top hip (shallow) above the waist — rises from the waist
      // rectangle at fraction `heightRatio` of activeRh up to the peak.
      const topRise = slope.activeRh * (1 - heightRatio)
      const topRun = Math.max(0, Math.min(halfW, halfD) - inset)
      tan = topRun > 0 ? topRise / topRun : 0
    }
    if (onZ) return buildSlopeNormal(0, lz >= 0 ? 1 : -1, tan)
    return buildSlopeNormal(lx >= 0 ? 1 : -1, 0, tan)
  }

  if (roofType === 'dutch') {
    // Hip on the short-axis ends, gable on the long-axis sides. Both
    // share the primary pitch on their primary (eave-band) face, so the
    // approximation collapses to "pick the dominant axis."
    const fx = halfW > 0 ? Math.abs(lx) / halfW : 0
    const fz = halfD > 0 ? Math.abs(lz) / halfD : 0
    if (fz >= fx) return buildSlopeNormal(0, lz >= 0 ? 1 : -1, primaryTan)
    return buildSlopeNormal(lx >= 0 ? 1 : -1, 0, primaryTan)
  }

  return new THREE.Vector3(0, 1, 0)
}

// ─── Quaternion helper ───────────────────────────────────────────────
// Given a normal in the panel's parent frame, build a rotation that
// aligns the panel's local +Y to that normal. Lifted out so the
// renderer and the placement preview share one source of truth.

export function surfaceQuatFromNormal(normal: THREE.Vector3, out: THREE.Quaternion) {
  // Build `right` by projecting world +X onto the surface plane instead of
  // using `up × normal`. The cross-product version flips sign when the
  // normal's Z component flips (e.g. the two slopes of a gable roof), so
  // the resulting basis has its +X axis reversed on one slope — which
  // makes hosted children's local +X point in opposite world directions
  // depending on which slope they sit on, and registry chevrons end up
  // anchored to the wrong edge. Projecting +X keeps the basis stable
  // across slope-flips that share the same X axis.
  const wx = new THREE.Vector3(1, 0, 0)
  const right = wx.sub(normal.clone().multiplyScalar(new THREE.Vector3(1, 0, 0).dot(normal)))
  if (right.lengthSq() < 1e-6) {
    // Degenerate: normal is parallel to ±X. Fall back to +Z so the basis
    // is still well-defined; this is the wall-like edge case (vertical
    // surface facing along X) where any in-plane convention is OK.
    right.set(0, 0, 1)
  } else {
    right.normalize()
  }
  const forward = new THREE.Vector3().crossVectors(right, normal).normalize()
  const m = new THREE.Matrix4().makeBasis(right, normal, forward)
  return out.setFromRotationMatrix(m)
}

// Yaw (about the surface normal, composed AFTER `surfaceQuatFromNormal`)
// that points the node's local +Z down the slope. The analytical normals
// are axis-aligned (n.x or n.z is 0), and in the +X-projected basis above
// the down-slope direction decomposes to atan2(n.x · n.y, n.z): +Z face
// → 0, −Z → π, +X → +π/2, −X → −π/2. Kept next to `surfaceQuatFromNormal`
// so the two stay in lockstep — the formula is only valid for its basis.
export function getDownSlopeYaw(lx: number, lz: number, seg: RoofSegmentNode): number {
  const n = getAnalyticalNormal(lx, lz, seg)
  if (n.x === 0 && n.z === 0) return 0
  return Math.atan2(n.x * n.y, n.z)
}
