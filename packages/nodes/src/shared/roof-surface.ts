import {
  getRoofModuleFaces,
  getRoofSegmentSurfaceY,
  getRoofShapeInsets,
  getRoofShapeRatios,
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

export function getRoofTopSurfaceY(lx: number, lz: number, seg: RoofSegmentNode): number {
  return getRoofSurfaceFaceBoundsAt(seg, lx, lz).surfaceYAt(lx, lz)
}

export type RoofSurfacePoint2D = [number, number]

export type RoofSurfaceFaceBounds = {
  polygon: RoofSurfacePoint2D[]
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  surfaceYAt: (x: number, z: number) => number
  xIntervalAtZ: (z: number) => [number, number] | null
  zIntervalAtX: (x: number) => [number, number] | null
}

export function getRoofSurfaceFaceBoundsAt(
  segment: RoofSegmentNode,
  lx: number,
  lz: number,
): RoofSurfaceFaceBounds {
  const faces = getRoofSurfaceFaces(segment)
  const face = topmostFaceAtPoint(faces, lx, lz) ?? nearestFaceToPoint(faces, [lx, lz])
  const { polygon } = face

  const xs = polygon.map((point) => point[0])
  const zs = polygon.map((point) => point[1])
  return {
    polygon,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
    surfaceYAt: (x, z) =>
      surfaceYOnFace(face.vertices, x, z) ?? getRoofSegmentSurfaceY(segment, x, z),
    xIntervalAtZ: (z) => lineInterval(polygon, 'x', z),
    zIntervalAtX: (x) => lineInterval(polygon, 'z', x),
  }
}

type RoofSurfaceFace = {
  polygon: RoofSurfacePoint2D[]
  vertices: FaceVertex[]
}
type FaceVertex = { x: number; y: number; z: number }

const SHINGLE_SURFACE_EPSILON = 0.02
const FACE_TOLERANCE = 1e-6
const ROOF_SURFACE_FACE_CACHE_MAX = 128
const roofSurfaceFaceCache = new Map<string, RoofSurfaceFace[]>()
const _downSlopeYawNormal = new THREE.Vector3()
const _surfaceQuatRight = new THREE.Vector3()
const _surfaceQuatForward = new THREE.Vector3()
const _surfaceQuatMatrix = new THREE.Matrix4()

function getRoofSurfaceFaces(segment: RoofSegmentNode): RoofSurfaceFace[] {
  const key = roofSurfaceFaceCacheKey(segment)
  const cached = roofSurfaceFaceCache.get(key)
  if (cached) return cached

  const faces = buildRoofSurfaceFaces(segment)
  roofSurfaceFaceCache.set(key, faces)
  if (roofSurfaceFaceCache.size > ROOF_SURFACE_FACE_CACHE_MAX) {
    const oldestKey = roofSurfaceFaceCache.keys().next().value
    if (oldestKey) roofSurfaceFaceCache.delete(oldestKey)
  }
  return faces
}

function roofSurfaceFaceCacheKey(segment: RoofSegmentNode): string {
  return [
    segment.roofType,
    segment.width,
    segment.depth,
    segment.wallHeight,
    segment.wallThickness,
    segment.deckThickness,
    segment.overhang,
    segment.shingleThickness,
    segment.pitch,
    segment.gambrelLowerWidthRatio ?? ROOF_SHAPE_DEFAULTS.gambrelLowerWidthRatio,
    segment.gambrelLowerHeightRatio ?? ROOF_SHAPE_DEFAULTS.gambrelLowerHeightRatio,
    segment.mansardSteepWidthRatio ?? ROOF_SHAPE_DEFAULTS.mansardSteepWidthRatio,
    segment.mansardSteepHeightRatio ?? ROOF_SHAPE_DEFAULTS.mansardSteepHeightRatio,
    segment.dutchHipWidthRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipWidthRatio,
    segment.dutchHipHeightRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipHeightRatio,
    segment.dutchWaistLengthRatio ?? ROOF_SHAPE_DEFAULTS.dutchWaistLengthRatio,
  ].join('|')
}

function buildRoofSurfaceFaces(segment: RoofSegmentNode): RoofSurfaceFace[] {
  const { roofType, width, depth, wallHeight, wallThickness, deckThickness, overhang } = segment
  const { activeRh, tanTheta, cosTheta, sinTheta } = getSegmentSlopeFrame(segment)

  const verticalRt = activeRh > 0 ? deckThickness / cosTheta : deckThickness
  const horizontalOverhang = (overhang ?? 0) * cosTheta
  const deckExt = wallThickness / 2 + horizontalOverhang
  const shingleThickness = segment.shingleThickness ?? 0
  const stSin = shingleThickness * sinTheta
  const stCos = shingleThickness * cosTheta

  const shinBotW = Math.max(0.01, width + 2 * deckExt)
  const shinBotD = Math.max(0.01, depth + 2 * deckExt)
  const deckDrop = deckExt * tanTheta
  const shinBotWh = wallHeight - deckDrop + verticalRt

  let shinBotRh = activeRh
  if (activeRh > 0) {
    shinBotRh = activeRh + deckDrop
    if (roofType === 'shed') shinBotRh = activeRh + 2 * deckDrop
  }

  let shinTopW = shinBotW
  let shinTopD = shinBotD
  let transZ = 0

  if (roofType === 'hip' || roofType === 'mansard' || roofType === 'dutch') {
    shinTopW += 2 * stSin
    shinTopD += 2 * stSin
  } else if (roofType === 'gable' || roofType === 'gambrel') {
    shinTopD += 2 * stSin
  } else if (roofType === 'shed') {
    shinTopD += stSin
    transZ = stSin / 2
  }

  const shinTopWh = shinBotWh + stCos
  let shinTopRh = shinBotRh
  if (activeRh > 0) shinTopRh = shinBotRh + stSin * tanTheta

  const availableR = (Math.min(shinBotW, shinBotD) / 2) * 0.95
  const maxDrop = tanTheta > 0.001 ? availableR / tanTheta : 2
  const dropTop = Math.min(1, maxDrop * 0.4)
  const topBaseY = shinBotWh - dropTop

  const dutchHipWidthRatio = segment.dutchHipWidthRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipWidthRatio
  const insetsTop = getRoofShapeInsets({
    roofType,
    width,
    depth,
    wh: shinTopWh,
    baseY: topBaseY,
    isVoid: false,
    brushW: shinTopW,
    brushD: shinTopD,
    tanTheta,
    shingleThickness,
    dutchHipWidthRatio,
  })
  const shapeRatios = getRoofShapeRatios({
    gambrelLowerWidthRatio: segment.gambrelLowerWidthRatio,
    mansardSteepWidthRatio: segment.mansardSteepWidthRatio,
    dutchHipWidthRatio,
    dutchHipHeightRatio: segment.dutchHipHeightRatio,
    dutchWaistLengthRatio: segment.dutchWaistLengthRatio,
    dutchGabletRake: segment.dutchGabletRake,
  })

  return getRoofModuleFaces({
    type: roofType,
    w: shinTopW,
    d: shinTopD,
    wh: shinTopWh,
    rh: shinTopRh,
    baseY: topBaseY,
    insets: insetsTop,
    baseW: width,
    baseD: depth,
    tanTheta,
    shapeRatios,
    dutchTopRakeThickness: segment.dutchTopRakeThickness,
  })
    .filter((face) => faceNormalY(face) > SHINGLE_SURFACE_EPSILON)
    .map((face) => {
      const vertices = face.map((point) => ({ ...point, z: point.z + transZ }))
      return {
        vertices,
        polygon: dedupePolygon(vertices.map((point) => [point.x, point.z])),
      }
    })
    .filter((face) => face.polygon.length >= 3)
}

function topmostFaceAtPoint(
  faces: RoofSurfaceFace[],
  lx: number,
  lz: number,
): RoofSurfaceFace | null {
  let best: RoofSurfaceFace | null = null
  let bestY = Number.NEGATIVE_INFINITY

  for (const face of faces) {
    if (!pointInPolygon([lx, lz], face.polygon)) continue
    const y = surfaceYOnFace(face.vertices, lx, lz)
    if (y === null || y <= bestY) continue
    best = face
    bestY = y
  }

  return best
}

function faceNormalY(face: FaceVertex[]): number {
  const a = face[0]
  const b = face[1]
  const c = face[2]
  if (!(a && b && c)) return 0
  const abx = b.x - a.x
  const aby = b.y - a.y
  const abz = b.z - a.z
  const acx = c.x - a.x
  const acy = c.y - a.y
  const acz = c.z - a.z
  return abz * acx - abx * acz
}

function dedupePolygon(points: RoofSurfacePoint2D[]): RoofSurfacePoint2D[] {
  const out: RoofSurfacePoint2D[] = []
  for (const point of points) {
    const prev = out.at(-1)
    if (prev && Math.hypot(prev[0] - point[0], prev[1] - point[1]) <= FACE_TOLERANCE) continue
    out.push(point)
  }
  const first = out[0]
  const last = out.at(-1)
  if (first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) <= FACE_TOLERANCE) {
    out.pop()
  }
  return out
}

function pointInPolygon(point: RoofSurfacePoint2D, polygon: RoofSurfacePoint2D[]): boolean {
  let inside = false
  const [px, pz] = point
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!
    const [xj, zj] = polygon[j]!
    if (pointOnSegment(point, [xi, zi], [xj, zj])) return true
    const intersects = zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function pointOnSegment(
  point: RoofSurfacePoint2D,
  a: RoofSurfacePoint2D,
  b: RoofSurfacePoint2D,
): boolean {
  const cross = (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1])
  if (Math.abs(cross) > FACE_TOLERANCE) return false
  const dot = (point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])
  if (dot < -FACE_TOLERANCE) return false
  const lengthSq = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2
  return dot <= lengthSq + FACE_TOLERANCE
}

function nearestFaceToPoint(faces: RoofSurfaceFace[], point: RoofSurfacePoint2D): RoofSurfaceFace {
  let best = faces[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const face of faces) {
    const distance = distanceToPolygon(point, face.polygon)
    if (distance < bestDistance) {
      best = face
      bestDistance = distance
    }
  }
  return (
    best ?? {
      polygon: [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ],
      vertices: [
        { x: -0.5, y: 0, z: -0.5 },
        { x: 0.5, y: 0, z: -0.5 },
        { x: 0.5, y: 0, z: 0.5 },
        { x: -0.5, y: 0, z: 0.5 },
      ],
    }
  )
}

function surfaceYOnFace(vertices: FaceVertex[], x: number, z: number): number | null {
  for (let i = 0; i < vertices.length - 2; i++) {
    const a = vertices[i]
    const b = vertices[i + 1]
    const c = vertices[i + 2]
    if (!(a && b && c)) continue
    const abx = b.x - a.x
    const aby = b.y - a.y
    const abz = b.z - a.z
    const acx = c.x - a.x
    const acy = c.y - a.y
    const acz = c.z - a.z
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    if (Math.abs(ny) <= FACE_TOLERANCE) continue
    return a.y - (nx * (x - a.x) + nz * (z - a.z)) / ny
  }
  return null
}

function distanceToPolygon(point: RoofSurfacePoint2D, polygon: RoofSurfacePoint2D[]): number {
  if (pointInPolygon(point, polygon)) return 0
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    best = Math.min(best, distanceToSegment(point, a, b))
  }
  return best
}

function distanceToSegment(
  point: RoofSurfacePoint2D,
  a: RoofSurfacePoint2D,
  b: RoofSurfacePoint2D,
): number {
  const abx = b[0] - a[0]
  const abz = b[1] - a[1]
  const lengthSq = abx * abx + abz * abz
  if (lengthSq <= FACE_TOLERANCE) return Math.hypot(point[0] - a[0], point[1] - a[1])
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * abx + (point[1] - a[1]) * abz) / lengthSq))
  return Math.hypot(point[0] - (a[0] + abx * t), point[1] - (a[1] + abz * t))
}

function lineInterval(
  polygon: RoofSurfacePoint2D[],
  axis: 'x' | 'z',
  value: number,
): [number, number] | null {
  const hits: number[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const aFixed = axis === 'x' ? a[1] : a[0]
    const bFixed = axis === 'x' ? b[1] : b[0]
    const aVar = axis === 'x' ? a[0] : a[1]
    const bVar = axis === 'x' ? b[0] : b[1]

    if (Math.abs(aFixed - value) <= FACE_TOLERANCE && Math.abs(bFixed - value) <= FACE_TOLERANCE) {
      hits.push(aVar, bVar)
      continue
    }
    if (value < Math.min(aFixed, bFixed) - FACE_TOLERANCE) continue
    if (value > Math.max(aFixed, bFixed) + FACE_TOLERANCE) continue
    if (Math.abs(aFixed - bFixed) <= FACE_TOLERANCE) continue

    const t = (value - aFixed) / (bFixed - aFixed)
    if (t < -FACE_TOLERANCE || t > 1 + FACE_TOLERANCE) continue
    hits.push(aVar + (bVar - aVar) * t)
  }

  const unique = Array.from(new Set(hits.map((hit) => hit.toFixed(6)))).map(Number)
  if (unique.length < 2) return null
  return [Math.min(...unique), Math.max(...unique)]
}

// Outward normal for a roof surface tilting at angle θ in the horizontal
// direction (dx, dz). Derivation: the surface tangent vectors are the
// ridge axis (perpendicular to the fall line, horizontal) and the
// down-slope direction (cos θ horizontal + −sin θ vertical). Crossing
// them gives the outward normal ∝ (sin θ · dx, cos θ, sin θ · dz),
// equivalently (dx · tan θ, 1, dz · tan θ) un-normalised.
function buildSlopeNormal(dx: number, dz: number, tan: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(dx * tan, 1, dz * tan).normalize()
}

export function getAnalyticalNormal(
  lx: number,
  lz: number,
  seg: RoofSegmentNode,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const { roofType, depth, width } = seg
  const slope = getSegmentSlopeFrame(seg)
  if (slope.activeRh === 0 || slope.tanTheta === 0) {
    return out.set(0, 1, 0)
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
        return buildSlopeNormal(0, lz >= 0 ? 1 : -1, upperTan, out)
      }
    }
    return buildSlopeNormal(0, lz >= 0 ? 1 : -1, primaryTan, out)
  }

  // Single slope falling toward +Z (ridge at -Z, eave at +Z).
  if (roofType === 'shed') {
    return buildSlopeNormal(0, 1, primaryTan, out)
  }

  // 4-sided slopes: the dominant axis chooses which face the point sits
  // on. Hip is uniform across all four faces. Mansard has a steep outer
  // band (primaryTan) and a shallow top inside the waist. Dutch has hip
  // ends and gable sides — both share the same primaryTan from the
  // slope frame, so directional dispatch is enough.
  if (roofType === 'hip') {
    const onZ = (halfD > 0 ? Math.abs(lz) / halfD : 0) >= (halfW > 0 ? Math.abs(lx) / halfW : 0)
    if (onZ) return buildSlopeNormal(0, lz >= 0 ? 1 : -1, primaryTan, out)
    return buildSlopeNormal(lx >= 0 ? 1 : -1, 0, primaryTan, out)
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
    if (onZ) return buildSlopeNormal(0, lz >= 0 ? 1 : -1, tan, out)
    return buildSlopeNormal(lx >= 0 ? 1 : -1, 0, tan, out)
  }

  if (roofType === 'dutch') {
    const inset =
      Math.min(width, depth) * (seg.dutchHipWidthRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipWidthRatio)
    const heightRatio = seg.dutchHipHeightRatio ?? ROOF_SHAPE_DEFAULTS.dutchHipHeightRatio
    const lengthRatio = seg.dutchWaistLengthRatio ?? ROOF_SHAPE_DEFAULTS.dutchWaistLengthRatio
    const lowerRise = slope.activeRh * heightRatio

    if (width >= depth) {
      const waistHalfX = Math.max(0, (halfW - inset) * lengthRatio)
      const waistHalfZ = Math.max(0, halfD - inset)
      if (Math.abs(lx) <= waistHalfX && Math.abs(lz) <= waistHalfZ) {
        const topRise = slope.activeRh * (1 - heightRatio)
        const topTan = waistHalfZ > 0 ? topRise / waistHalfZ : 0
        return buildSlopeNormal(0, lz >= 0 ? 1 : -1, topTan, out)
      }

      const xRun = Math.max(0.0001, halfW - waistHalfX)
      const zRun = Math.max(0.0001, halfD - waistHalfZ)
      const xTan = Math.abs(lx) > waistHalfX ? lowerRise / xRun : 0
      const zTan = Math.abs(lz) > waistHalfZ ? lowerRise / zRun : 0
      return out.set((lx >= 0 ? 1 : -1) * xTan, 1, (lz >= 0 ? 1 : -1) * zTan).normalize()
    }

    const waistHalfX = Math.max(0, halfW - inset)
    const waistHalfZ = Math.max(0, (halfD - inset) * lengthRatio)
    if (Math.abs(lx) <= waistHalfX && Math.abs(lz) <= waistHalfZ) {
      const topRise = slope.activeRh * (1 - heightRatio)
      const topTan = waistHalfX > 0 ? topRise / waistHalfX : 0
      return buildSlopeNormal(lx >= 0 ? 1 : -1, 0, topTan, out)
    }

    const xRun = Math.max(0.0001, halfW - waistHalfX)
    const zRun = Math.max(0.0001, halfD - waistHalfZ)
    const xTan = Math.abs(lx) > waistHalfX ? lowerRise / xRun : 0
    const zTan = Math.abs(lz) > waistHalfZ ? lowerRise / zRun : 0
    return out.set((lx >= 0 ? 1 : -1) * xTan, 1, (lz >= 0 ? 1 : -1) * zTan).normalize()
  }

  return out.set(0, 1, 0)
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
  const right = _surfaceQuatRight.set(1, 0, 0).addScaledVector(normal, -normal.x)
  if (right.lengthSq() < 1e-6) {
    // Degenerate: normal is parallel to ±X. Fall back to +Z so the basis
    // is still well-defined; this is the wall-like edge case (vertical
    // surface facing along X) where any in-plane convention is OK.
    right.set(0, 0, 1)
  } else {
    right.normalize()
  }
  _surfaceQuatForward.crossVectors(right, normal).normalize()
  _surfaceQuatMatrix.makeBasis(right, normal, _surfaceQuatForward)
  return out.setFromRotationMatrix(_surfaceQuatMatrix)
}

// Yaw (about the surface normal, composed AFTER `surfaceQuatFromNormal`)
// that points the node's local +Z down the slope. The analytical normals
// are axis-aligned (n.x or n.z is 0), and in the +X-projected basis above
// the down-slope direction decomposes to atan2(n.x · n.y, n.z): +Z face
// → 0, −Z → π, +X → +π/2, −X → −π/2. Kept next to `surfaceQuatFromNormal`
// so the two stay in lockstep — the formula is only valid for its basis.
export function getDownSlopeYaw(lx: number, lz: number, seg: RoofSegmentNode): number {
  const n = getAnalyticalNormal(lx, lz, seg, _downSlopeYawNormal)
  if (n.x === 0 && n.z === 0) return 0
  return Math.atan2(n.x * n.y, n.z)
}
