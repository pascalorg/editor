import type { CeilingFrameConfig, CeilingMedallionConfig } from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

type Pt = readonly [number, number]

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** Smooth C1 cosine-squared dome in [0, 1] over [u0, u1]. */
function dome(u: number, u0: number, u1: number): number {
  if (u <= u0 || u >= u1) return 0
  const s = Math.sin(Math.PI * ((u - u0) / (u1 - u0)))
  return s * s
}

/** Smooth polynomial maximum so overlapping sculpted relief forms blend with plaster fillets. */
function smax(a: number, b: number, k = 0.05): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.max(a, b) + h * h * k * 0.25
}

function wrapAngle(a: number, period: number): number {
  const m = ((a % period) + period) % period
  return m > period / 2 ? m - period : m
}

function ensureUv2(geometry: THREE.BufferGeometry) {
  const uv = geometry.getAttribute('uv')
  if (!uv) return
  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(Array.from(uv.array), 2))
}

// ============================================================================
// 2D POLYGON HELPERS (LEVEL XZ)
// ============================================================================

function signedAreaXZ(poly: readonly Pt[]): number {
  let sum = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return sum / 2
}

function pointInRing(pt: Pt, ring: readonly Pt[]): boolean {
  const [px, pz] = pt
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!
    const [xj, zj] = ring[j]!
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function pointInCeiling(
  pt: Pt,
  polygon: readonly Pt[],
  holes: readonly (readonly Pt[])[],
): boolean {
  if (!pointInRing(pt, polygon)) return false
  for (const hole of holes) {
    if (hole.length >= 3 && pointInRing(pt, hole)) return false
  }
  return true
}

function polygonCentroid(poly: readonly Pt[]): [number, number] | null {
  if (poly.length < 3) return null
  let area2 = 0
  let cx = 0
  let cz = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]!
    const [x1, z1] = poly[(i + 1) % poly.length]!
    const cross = x0 * z1 - x1 * z0
    area2 += cross
    cx += (x0 + x1) * cross
    cz += (z0 + z1) * cross
  }
  if (Math.abs(area2) < 1e-6) return null
  return [cx / (3 * area2), cz / (3 * area2)]
}

/** Find a clean interior centre for non-convex/L-shaped ceilings when centroid falls outside. */
function interiorPointFallback(
  polygon: readonly Pt[],
  holes: readonly (readonly Pt[])[],
): [number, number] | null {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of polygon) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const steps = 9
  let best: [number, number] | null = null
  let bestDist = -1
  for (let ix = 1; ix < steps; ix++) {
    for (let iz = 1; iz < steps; iz++) {
      const candidate: [number, number] = [
        minX + ((maxX - minX) * ix) / steps,
        minZ + ((maxZ - minZ) * iz) / steps,
      ]
      if (!pointInCeiling(candidate, polygon, holes)) continue
      const d = minDistToRing(candidate, polygon)
      if (d > bestDist) {
        bestDist = d
        best = candidate
      }
    }
  }
  return best
}

function minDistToRing(pt: Pt, ring: readonly Pt[]): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const lenSq = dx * dx + dz * dz
    const t = lenSq < 1e-12 ? 0 : clamp01(((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dz) / lenSq)
    const d = Math.hypot(pt[0] - (a[0] + dx * t), pt[1] - (a[1] + dz * t))
    if (d < best) best = d
  }
  return best
}

/**
 * Resolve the medallion's [x, z] placement centre on a ceiling.
 * Returns null if the polygon is degenerate or an automatic centre falls inside a ceiling hole.
 */
export function resolveMedallionCenter(
  polygon: readonly Pt[],
  holes: readonly (readonly Pt[])[],
  config: Pick<CeilingMedallionConfig, 'at' | 'offset'>,
): [number, number] | null {
  if (polygon.length < 3) return null
  if (config.at) return [config.at[0], config.at[1]]
  const base = polygonCentroid(polygon)
  const dx = config.offset?.[0] ?? 0
  const dz = config.offset?.[1] ?? 0
  if (base) {
    const shifted: [number, number] = [base[0] + dx, base[1] + dz]
    if (pointInCeiling(shifted, polygon, holes)) return shifted
    // If centroid itself fell inside a hole (e.g. skylight shaft), skip automatic placement.
    if (pointInRing(shifted, polygon)) return null
  }
  const interior = interiorPointFallback(polygon, holes)
  if (!interior) return null
  const shifted: [number, number] = [interior[0] + dx, interior[1] + dz]
  return pointInCeiling(shifted, polygon, holes) ? shifted : null
}

// ============================================================================
// SCULPTED BAS-RELIEF MEDALLION HEIGHT FUNCTIONS (H(u, theta) in [0, 1])
// ============================================================================

function haussmannAcantheHeight(u: number, theta: number): number {
  // 1. Classical outer rim: crisp fillet + sweeping doucine (cyma recta) + cavetto shadow cove
  let h = 0
  if (u > 0.83) {
    const fillet = 0.24 * smoothstep(1.0, 0.982, u)
    const doucine = 0.34 * smoothstep(0.97, 0.905, u) * smoothstep(0.83, 0.885, u)
    const rimBead = 0.08 * dome(u, 0.895, 0.955)
    const dishBase = 0.2 * smoothstep(0.89, 0.83, u)
    h = Math.max(fillet, dishBase) + doucine + rimBead
  } else if (u > 0.755) {
    // 2. Astragal torus with 48 finely modelled continuous plaster pearls
    const torus = 0.2 + 0.24 * dome(u, 0.758, 0.832)
    const pearl = 0.17 * dome(u, 0.77, 0.822) * (0.5 + 0.5 * Math.cos(48 * theta)) ** 1.5
    h = torus + pearl
  } else if (u > 0.265) {
    // 3. Concave dish + 12 grand layered acanthus leaves + 12 staggered secondary palmette fronds
    const dishT = clamp01((u - 0.265) / 0.49)
    const dish = 0.2 + 0.14 * (1 - dishT)

    // Primary acanthus crown (12 sculpted leaves)
    const sector = (Math.PI * 2) / 12
    const phi1 = wrapAngle(theta, sector)
    const w1 = Math.abs(phi1) / (sector * 0.5)
    const s1 = clamp01((u - 0.27) / 0.475)
    let primary = 0
    if (s1 > 0 && s1 < 1) {
      const taper = Math.sin(Math.PI * s1 ** 0.72)
      const serration = 0.82 + 0.18 * Math.cos(4 * Math.PI * s1)
      const halfW = (0.3 + 0.62 * taper) * serration * (1 - 0.12 * s1)
      const mask = 1 - smoothstep(halfW * 0.72, halfW, w1)
      if (mask > 0.001) {
        const across = clamp01(w1 / Math.max(0.12, halfW))
        const body = 0.26 * Math.sin(Math.PI * s1 ** 0.58) * (1 - 0.32 * across * across)
        const midrib = 0.24 * Math.exp(-((w1 / 0.13) ** 2)) * Math.sin(Math.PI * s1 ** 0.62)
        const sideLobes =
          0.12 * (0.5 + 0.5 * Math.cos(4 * Math.PI * (s1 - 0.24 * w1))) * smoothstep(0.06, 0.26, w1)
        const curledTip = 0.11 * dome(s1, 0.74, 0.99) * (1 - smoothstep(0.0, 0.45, across))
        primary = mask * (body + midrib + sideLobes + curledTip)
      }
    }

    // Alternating secondary lanceolate fronds (offset by half a sector)
    const phi2 = wrapAngle(theta + sector * 0.5, sector)
    const w2 = Math.abs(phi2) / (sector * 0.5)
    const s2 = clamp01((u - 0.285) / 0.41)
    let secondary = 0
    if (s2 > 0 && s2 < 1) {
      const halfW2 = 0.48 * Math.sin(Math.PI * s2 ** 0.68)
      const mask2 = 1 - smoothstep(halfW2 * 0.65, halfW2, w2)
      if (mask2 > 0.001) {
        const spine2 = 0.22 * Math.exp(-((w2 / 0.11) ** 2)) * Math.sin(Math.PI * s2 ** 0.6)
        const blade2 = 0.16 * Math.sin(Math.PI * s2 ** 0.55)
        secondary = mask2 * (blade2 + spine2)
      }
    }

    h = dish + smax(primary, secondary * 0.86, 0.045)
  } else {
    // 4. Inner astragal collar + 12-petal sculpted floral heart + turned chandelier canopy boss
    const collar = 0.34 + 0.24 * dome(u, 0.215, 0.265)
    const petals =
      0.38 +
      0.34 * dome(u, 0.085, 0.235) * (0.28 + 0.72 * (0.5 + 0.5 * Math.cos(12 * theta)) ** 1.3)
    const bossLip = 0.56 + 0.28 * dome(u, 0.065, 0.115)
    const centerCap = 0.94 * smoothstep(0.11, 0.045, u) + 0.04 * smoothstep(0.045, 0, u)
    h = smax(
      smax(collar, petals, 0.04),
      smax(bossLip * smoothstep(0.14, 0.09, u), centerCap, 0.04),
      0.04,
    )
  }
  return clamp01(h)
}

function empirePalmetteHeight(u: number, theta: number): number {
  if (u > 0.855) {
    const step1 = 0.26 * smoothstep(1.0, 0.975, u)
    const ogee = 0.36 * dome(u, 0.87, 0.965)
    const cove = 0.22 * smoothstep(0.89, 0.855, u)
    return clamp01(Math.max(step1, cove) + ogee)
  }
  if (u > 0.765) {
    // Laurel wreath torus band with angled chevron leaves
    const band = 0.22 + 0.26 * dome(u, 0.768, 0.855)
    const chevron =
      0.16 * dome(u, 0.778, 0.845) * (0.5 + 0.5 * Math.cos(32 * theta + 28 * Math.abs(u - 0.812)))
    return clamp01(band + chevron)
  }
  if (u > 0.27) {
    const dish = 0.2 + 0.12 * (1 - clamp01((u - 0.27) / 0.495))
    // 8 grand 5-frond anthemion palmettes + 8 slender lotus buds
    const pairSector = (Math.PI * 2) / 8
    const phiP = wrapAngle(theta, pairSector)
    const wP = Math.abs(phiP) / (pairSector * 0.5)
    const sP = clamp01((u - 0.28) / 0.47)
    let palmette = 0
    if (sP > 0 && sP < 1) {
      // 5 radiating slender fronds inside each palmette fan
      const fanWidth = 0.62 * Math.sin(Math.PI * sP ** 0.7)
      const fanMask = 1 - smoothstep(fanWidth * 0.78, fanWidth, wP)
      if (fanMask > 0.001) {
        const frondPhase = (wP / Math.max(0.14, fanWidth)) * 2.5 * Math.PI
        const fronds = 0.5 + 0.5 * Math.cos(frondPhase * 2)
        const baseScroll = 0.24 * dome(sP, 0.0, 0.35) * (1 - smoothstep(0.1, 0.5, wP))
        palmette = fanMask * (0.14 + 0.32 * fronds * Math.sin(Math.PI * sP ** 0.65) + baseScroll)
      }
    }
    const phiL = wrapAngle(theta + pairSector * 0.5, pairSector)
    const wL = Math.abs(phiL) / (pairSector * 0.5)
    const sL = clamp01((u - 0.31) / 0.41)
    let lotus = 0
    if (sL > 0 && sL < 1) {
      const halfWL = 0.24 * Math.sin(Math.PI * sL ** 0.75)
      const maskL = 1 - smoothstep(halfWL * 0.65, halfWL, wL)
      if (maskL > 0.001) {
        lotus = maskL * (0.28 * Math.sin(Math.PI * sL ** 0.6) + 0.12 * dome(sL, 0.55, 0.95))
      }
    }
    return clamp01(dish + smax(palmette, lotus, 0.04))
  }
  const innerBead = 0.32 + 0.26 * dome(u, 0.215, 0.275) * (0.7 + 0.3 * Math.cos(32 * theta))
  const sunburst =
    0.4 + 0.32 * dome(u, 0.08, 0.225) * (0.4 + 0.6 * (0.5 + 0.5 * Math.cos(16 * theta)))
  const boss = 0.92 * smoothstep(0.105, 0.04, u)
  return clamp01(smax(smax(innerBead, sunburst, 0.04), boss, 0.04))
}

function classiqueGodronsHeight(u: number, theta: number): number {
  if (u > 0.8) {
    const fillet = 0.24 * smoothstep(1.0, 0.98, u)
    const doucine = 0.38 * dome(u, 0.86, 0.96)
    const cavetto = 0.22 * smoothstep(0.86, 0.8, u)
    return clamp01(Math.max(fillet, cavetto) + doucine)
  }
  if (u > 0.75) {
    return clamp01(0.24 + 0.3 * dome(u, 0.752, 0.805))
  }
  if (u > 0.24) {
    // 32 crisp convex radial gadroon flutes separated by clean narrow channels
    const t = clamp01((u - 0.24) / 0.51)
    const env = Math.sin(Math.PI * t) ** 0.52
    const flute = Math.abs(Math.cos(16 * theta)) ** 0.62
    return clamp01(0.2 + 0.54 * env * flute)
  }
  const collar = 0.34 + 0.28 * dome(u, 0.18, 0.248)
  const centerPetals =
    0.42 + 0.28 * dome(u, 0.075, 0.19) * (0.35 + 0.65 * (0.5 + 0.5 * Math.cos(16 * theta)))
  const boss = 0.9 * smoothstep(0.095, 0.035, u)
  return clamp01(smax(smax(collar, centerPetals, 0.035), boss, 0.035))
}

function artDecoRadialHeight(u: number, theta: number): number {
  if (u > 0.78) {
    // Three crisp Art Deco concentric ziggurat steps
    const s1 = 0.26 * smoothstep(1.0, 0.98, u)
    const s2 = 0.24 * smoothstep(0.93, 0.91, u)
    const s3 = 0.2 * smoothstep(0.855, 0.835, u)
    const drop = -0.38 * smoothstep(0.805, 0.78, u)
    return clamp01(s1 + s2 + s3 + drop)
  }
  if (u > 0.26) {
    // 16 geometric pleated sunburst fan rays with stepped mid-chevron band
    const t = clamp01((u - 0.26) / 0.52)
    const sector = (Math.PI * 2) / 16
    const w = Math.abs(wrapAngle(theta, sector)) / (sector * 0.5)
    const ray = 1 - smoothstep(0.15, 0.88, w)
    const stepMid = 0.16 * smoothstep(0.58, 0.54, t) * smoothstep(0.12, 0.2, t)
    const fan = 0.42 * ray * smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.88, t)
    return clamp01(0.24 + fan + stepMid)
  }
  const tier1 = 0.58 * smoothstep(0.27, 0.245, u)
  const tier2 = 0.24 * smoothstep(0.17, 0.15, u)
  const tier3 = 0.14 * smoothstep(0.085, 0.065, u)
  return clamp01(tier1 + tier2 + tier3)
}

function moulureAnneauxHeight(u: number): number {
  const outerFillet = 0.24 * smoothstep(1.0, 0.98, u)
  const doucine = 0.36 * dome(u, 0.85, 0.965)
  const torus = 0.42 * dome(u, 0.65, 0.77)
  const dish = 0.24 * smoothstep(0.85, 0.74, u)
  const innerOvolo = 0.38 * dome(u, 0.24, 0.38)
  const centerDisc = 0.86 * smoothstep(0.18, 0.12, u) + 0.08 * smoothstep(0.07, 0.02, u)
  return clamp01(
    smax(
      smax(Math.max(outerFillet, dish) + doucine, dish + torus, 0.04),
      smax(dish + innerOvolo, centerDisc, 0.04),
      0.04,
    ),
  )
}

function sampleMedallionHeight(
  style: CeilingMedallionConfig['style'],
  u: number,
  theta: number,
): number {
  switch (style) {
    case 'haussmann-acanthe':
      return haussmannAcantheHeight(u, theta)
    case 'empire-palmette':
      return empirePalmetteHeight(u, theta)
    case 'classique-godrons':
      return classiqueGodronsHeight(u, theta)
    case 'art-deco-radial':
      return artDecoRadialHeight(u, theta)
    case 'moulure-anneaux':
      return moulureAnneauxHeight(u)
  }
}

/**
 * Build a watertight, continuous polar bas-relief mesh for a ceiling medallion (rosace),
 * seated flush at y = 0 and protruding down into the room (-Y) with verified downward normals.
 */
export function buildCeilingMedallionGeometry(
  config: Pick<CeilingMedallionConfig, 'style' | 'diameter' | 'relief'>,
  center: readonly [number, number] = [0, 0],
  options: { radialSegments?: number; angularSegments?: number } = {},
): THREE.BufferGeometry {
  const R = config.diameter / 2
  const relief = config.relief
  const [cx, cz] = center
  const radialSegments = options.radialSegments ?? (config.style === 'moulure-anneaux' ? 48 : 72)
  const angularSegments = options.angularSegments ?? (config.style === 'moulure-anneaux' ? 96 : 192)

  // Vertex 0 is the shared central apex; rings 1..radialSegments have angularSegments vertices each.
  const vertCount = 1 + radialSegments * angularSegments
  const positions = new Float32Array(vertCount * 3)
  const uvs = new Float32Array(vertCount * 2)

  const h0 = sampleMedallionHeight(config.style, 0, 0)
  positions[0] = cx
  positions[1] = -relief * h0
  positions[2] = cz
  uvs[0] = 0.5
  uvs[1] = 0.5

  let ptr = 1
  for (let ir = 1; ir <= radialSegments; ir++) {
    const u = ir / radialSegments
    const r = u * R
    for (let it = 0; it < angularSegments; it++) {
      const theta = (it / angularSegments) * Math.PI * 2
      const cos = Math.cos(theta)
      const sin = Math.sin(theta)
      const h = ir === radialSegments ? 0 : sampleMedallionHeight(config.style, u, theta)
      positions[ptr * 3] = cx + r * cos
      positions[ptr * 3 + 1] = -relief * h
      positions[ptr * 3 + 2] = cz + r * sin
      uvs[ptr * 2] = 0.5 + 0.5 * u * cos
      uvs[ptr * 2 + 1] = 0.5 + 0.5 * u * sin
      ptr++
    }
  }

  // Winding check: for x = r*cos(theta), z = r*sin(theta),
  // (p(r1, t0) - p(r0, t0)) x (p(r0, t1) - p(r0, t0)) = (+X) x (+Z) = (0, -1, 0) = -Y (downward!).
  const indices: number[] = []
  // Center fan (ring 1)
  for (let it = 0; it < angularSegments; it++) {
    const next = (it + 1) % angularSegments
    indices.push(0, 1 + it, 1 + next)
  }
  // Concentric quad rings
  for (let ir = 1; ir < radialSegments; ir++) {
    const ring0 = 1 + (ir - 1) * angularSegments
    const ring1 = 1 + ir * angularSegments
    for (let it = 0; it < angularSegments; it++) {
      const next = (it + 1) % angularSegments
      const i00 = ring0 + it
      const i01 = ring0 + next
      const i10 = ring1 + it
      const i11 = ring1 + next
      indices.push(i00, i10, i11, i00, i11, i01)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  ensureUv2(geometry)
  return geometry
}

// ============================================================================
// SWEPT MOULDED CEILING FRAME (CADRE / DOUBLE-CADRE / CAISSONS)
// ============================================================================

/** Deduplicate near-coincident consecutive vertices and return CCW loop in XZ. */
function normalizeLoopCCW(raw: readonly Pt[]): [number, number][] | null {
  const pts: [number, number][] = []
  for (const [x, z] of raw) {
    const prev = pts[pts.length - 1]
    if (!prev || Math.hypot(x - prev[0], z - prev[1]) > 1e-4) pts.push([x, z])
  }
  while (
    pts.length > 2 &&
    Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]) <= 1e-4
  ) {
    pts.pop()
  }
  if (pts.length < 3) return null
  const area = signedAreaXZ(pts)
  if (Math.abs(area) < 1e-4) return null
  return area > 0 ? pts : [...pts].reverse()
}

/**
 * Inward mitered offset of a CCW polygon in XZ.
 * Returns null if the offset collapses or flips any edge.
 */
function offsetPolygonInward(
  ccw: readonly [number, number][],
  distance: number,
): [number, number][] | null {
  const n = ccw.length
  if (n < 3 || distance <= 0) return null
  const dirs: [number, number][] = []
  const normals: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = ccw[i]!
    const b = ccw[(i + 1) % n]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len < 1e-5) return null
    const ux = dx / len
    const uz = dz / len
    dirs.push([ux, uz])
    // For CCW in XZ (signedArea > 0: x right, z down -> interior is to the LEFT of edge = (-uz, ux))
    normals.push([-uz, ux])
  }
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const prev = (i + n - 1) % n
    const n0 = normals[prev]!
    const n1 = normals[i]!
    const d0 = dirs[prev]!
    const d1 = dirs[i]!
    const p = ccw[i]!
    // Bisector intersection of shifted edge lines
    const denom = d0[0] * d1[1] - d0[1] * d1[0]
    if (Math.abs(denom) < 1e-5) {
      out.push([p[0] + n1[0] * distance, p[1] + n1[1] * distance])
    } else {
      const p0x = p[0] + n0[0] * distance
      const p0z = p[1] + n0[1] * distance
      const p1x = p[0] + n1[0] * distance
      const p1z = p[1] + n1[1] * distance
      const t = ((p1x - p0x) * d1[1] - (p1z - p0z) * d1[0]) / denom
      const ox = p0x + d0[0] * t
      const oz = p0z + d0[1] * t
      const shift = Math.hypot(ox - p[0], oz - p[1])
      if (shift > distance * 4) {
        // Clamp extreme acute miters safely
        const mx = n0[0] + n1[0]
        const mz = n0[1] + n1[1]
        const ml = Math.hypot(mx, mz) || 1
        out.push([p[0] + (mx / ml) * distance * 2, p[1] + (mz / ml) * distance * 2])
      } else {
        out.push([ox, oz])
      }
    }
  }
  // Reject collapsed or inverted polygons
  if (signedAreaXZ(out) < 0.08) return null
  for (let i = 0; i < n; i++) {
    const a = out[i]!
    const b = out[(i + 1) % n]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len < 0.08) return null
    const dot = (dx * dirs[i]![0] + dz * dirs[i]![1]) / len
    if (dot < 0.5) return null
  }
  return out
}

/**
 * Replace near-90° convex corners with Haussmannian concave quarter-circle re-entrant arcs
 * and return both the notched loop and the corner rosette centres.
 */
function notchHaussmannCorners(
  ccw: readonly [number, number][],
  notchRadius: number,
): { loop: [number, number][]; rosetteCenters: [number, number][] } {
  const n = ccw.length
  const loop: [number, number][] = []
  const rosetteCenters: [number, number][] = []
  const arcSegments = 8
  for (let i = 0; i < n; i++) {
    const prev = ccw[(i + n - 1) % n]!
    const curr = ccw[i]!
    const next = ccw[(i + 1) % n]!
    const vInX = curr[0] - prev[0]
    const vInZ = curr[1] - prev[1]
    const vOutX = next[0] - curr[0]
    const vOutZ = next[1] - curr[1]
    const lenIn = Math.hypot(vInX, vInZ)
    const lenOut = Math.hypot(vOutX, vOutZ)
    const uInX = vInX / lenIn
    const uInZ = vInZ / lenIn
    const uOutX = vOutX / lenOut
    const uOutZ = vOutZ / lenOut
    // Cross > 0 means convex corner in CCW XZ
    const cross = uInX * uOutZ - uInZ * uOutX
    const dot = uInX * uOutX + uInZ * uOutZ
    const r = Math.min(notchRadius, lenIn * 0.22, lenOut * 0.22)
    if (cross > 0.7 && Math.abs(dot) < 0.35 && r >= 0.06) {
      // Quarter-circle centred at `curr`, curving inward from entry point to exit point
      const pStartX = curr[0] - uInX * r
      const pStartZ = curr[1] - uInZ * r
      const a0 = Math.atan2(pStartZ - curr[1], pStartX - curr[0])
      const pEndX = curr[0] + uOutX * r
      const pEndZ = curr[1] + uOutZ * r
      const a1 = Math.atan2(pEndZ - curr[1], pEndX - curr[0])
      let da = a1 - a0
      while (da > Math.PI) da -= Math.PI * 2
      while (da < -Math.PI) da += Math.PI * 2
      for (let k = 0; k <= arcSegments; k++) {
        const a = a0 + (da * k) / arcSegments
        loop.push([curr[0] + Math.cos(a) * r, curr[1] + Math.sin(a) * r])
      }
      // Corner rosette tucked cleanly into the bay at the corner vertex
      rosetteCenters.push([curr[0], curr[1]])
    } else {
      loop.push([curr[0], curr[1]])
    }
  }
  return { loop, rosetteCenters }
}

/** Classical ogee/doucine moulding cross-section in (offsetAcrossWidth ∈ [-0.5, 0.5], heightFrac ∈ [0, 1]). */
const CLASSICAL_FRAME_PROFILE: readonly [number, number][] = [
  [-0.5, 0.0],
  [-0.5, 0.26],
  [-0.38, 0.34],
  [-0.24, 0.78],
  [-0.06, 1.0],
  [0.12, 0.9],
  [0.26, 0.48],
  [0.39, 0.4],
  [0.5, 0.24],
  [0.5, 0.0],
]

/** Finer baguette/filet cross-section for inner Haussmannian frames and coffer ribs. */
const BAGUETTE_PROFILE: readonly [number, number][] = [
  [-0.5, 0.0],
  [-0.5, 0.3],
  [-0.3, 0.85],
  [0.0, 1.0],
  [0.3, 0.85],
  [0.5, 0.3],
  [0.5, 0.0],
]

/**
 * Sweep a downward-protruding plaster moulding profile around a closed CCW loop in XZ.
 * All outward/downward faces have verified FrontSide normals pointing into the room.
 */
function sweepClosedMouldingLoop(
  ccw: readonly [number, number][],
  width: number,
  relief: number,
  profile: readonly [number, number][],
): THREE.BufferGeometry {
  const n = ccw.length
  const pCount = profile.length
  const miters: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const prev = ccw[(i + n - 1) % n]!
    const curr = ccw[i]!
    const next = ccw[(i + 1) % n]!
    const d0x = curr[0] - prev[0]
    const d0z = curr[1] - prev[1]
    const l0 = Math.hypot(d0x, d0z) || 1
    const d1x = next[0] - curr[0]
    const d1z = next[1] - curr[1]
    const l1 = Math.hypot(d1x, d1z) || 1
    // Inward normals (-uz, ux)
    const n0x = -d0z / l0
    const n0z = d0x / l0
    const n1x = -d1z / l1
    const n1z = d1x / l1
    const bx = n0x + n1x
    const bz = n0z + n1z
    const bl = Math.hypot(bx, bz)
    if (bl < 1e-5) {
      miters.push([n1x, n1z])
    } else {
      const ux = bx / bl
      const uz = bz / bl
      const dot = clamp(ux * n1x + uz * n1z, 0.35, 1)
      miters.push([ux / dot, uz / dot])
    }
  }

  const positions = new Float32Array(n * pCount * 3)
  const uvs = new Float32Array(n * pCount * 2)
  let accumU = 0
  for (let i = 0; i < n; i++) {
    const [px, pz] = ccw[i]!
    const [mx, mz] = miters[i]!
    if (i > 0) {
      const prev = ccw[i - 1]!
      accumU += Math.hypot(px - prev[0], pz - prev[1])
    }
    for (let j = 0; j < pCount; j++) {
      const [s, h] = profile[j]!
      const idx = i * pCount + j
      // s goes from -0.5 (outer) to +0.5 (inner along inward miter)
      positions[idx * 3] = px + mx * (s * width)
      positions[idx * 3 + 1] = -h * relief
      positions[idx * 3 + 2] = pz + mz * (s * width)
      uvs[idx * 2] = accumU
      uvs[idx * 2 + 1] = s + 0.5
    }
  }

  // Winding check along +X edge (inward normal = +Z):
  // Moving along loop = +X, moving along profile j -> j+1 = +Z (inward)
  // (+X) x (+Z) = (0, -1, 0) = -Y (downward into the room!).
  // So triangles (i00, i10, i11) and (i00, i11, i01) where i10 = next loop vertex, i01 = next profile vertex!
  const indices: number[] = []
  for (let i = 0; i < n; i++) {
    const nextI = (i + 1) % n
    for (let j = 0; j < pCount - 1; j++) {
      const i00 = i * pCount + j
      const i10 = nextI * pCount + j
      const i01 = i * pCount + (j + 1)
      const i11 = nextI * pCount + (j + 1)
      indices.push(i00, i10, i11, i00, i11, i01)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  ensureUv2(geometry)
  return geometry
}

/** Sweep a straight moulding rib from point A to point B (used for coffered ceiling ribs). */
function sweepStraightRib(
  a: Pt,
  b: Pt,
  width: number,
  relief: number,
  profile: readonly [number, number][],
): THREE.BufferGeometry | null {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len = Math.hypot(dx, dz)
  if (len < 0.05) return null
  const nx = -dz / len
  const nz = dx / len
  const pCount = profile.length
  const positions = new Float32Array(2 * pCount * 3)
  const uvs = new Float32Array(2 * pCount * 2)
  for (let end = 0; end < 2; end++) {
    const [px, pz] = end === 0 ? a : b
    for (let j = 0; j < pCount; j++) {
      const [s, h] = profile[j]!
      const idx = end * pCount + j
      positions[idx * 3] = px + nx * (s * width)
      positions[idx * 3 + 1] = -h * relief
      positions[idx * 3 + 2] = pz + nz * (s * width)
      uvs[idx * 2] = end * len
      uvs[idx * 2 + 1] = s + 0.5
    }
  }
  const indices: number[] = []
  for (let j = 0; j < pCount - 1; j++) {
    indices.push(j, pCount + j, pCount + j + 1, j, pCount + j + 1, j + 1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  ensureUv2(geometry)
  return geometry
}

function mergeNormalized(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]!
  const nonIndexed = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  const merged = mergeGeometries(nonIndexed, false)
  for (const g of parts) g.dispose()
  for (const g of nonIndexed) if (!parts.includes(g)) g.dispose()
  if (!merged) return null
  ensureUv2(merged)
  return merged
}

/** Clip an axis-aligned line segment against a CCW polygon; returns interior spans. */
function clipLineToPolygon(
  ccw: readonly [number, number][],
  axis: 'x' | 'z',
  coord: number,
): [number, number][] {
  const crossings: number[] = []
  for (let i = 0; i < ccw.length; i++) {
    const a = ccw[i]!
    const b = ccw[(i + 1) % ccw.length]!
    const u0 = axis === 'x' ? a[0] : a[1]
    const u1 = axis === 'x' ? b[0] : b[1]
    const v0 = axis === 'x' ? a[1] : a[0]
    const v1 = axis === 'x' ? b[1] : b[0]
    if ((u0 <= coord && u1 > coord) || (u1 <= coord && u0 > coord)) {
      const t = (coord - u0) / (u1 - u0)
      crossings.push(v0 + t * (v1 - v0))
    }
  }
  crossings.sort((a, b) => a - b)
  const spans: [number, number][] = []
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    if (crossings[i + 1]! - crossings[i]! > 0.15) spans.push([crossings[i]!, crossings[i + 1]!])
  }
  return spans
}

/**
 * Build a swept architectural plaster ceiling frame (haussmann-cadre, classique-filet,
 * double-cadre, or caissons) following the ceiling's real polygon.
 */
export function buildCeilingFrameGeometry(
  polygon: readonly Pt[],
  holes: readonly (readonly Pt[])[],
  config: Pick<CeilingFrameConfig, 'style' | 'inset' | 'width' | 'relief' | 'notchedCorners'>,
): THREE.BufferGeometry | null {
  const ccw = normalizeLoopCCW(polygon)
  if (!ccw) return null
  const outerLoop = offsetPolygonInward(ccw, config.inset)
  if (!outerLoop) return null

  const parts: THREE.BufferGeometry[] = []
  parts.push(
    sweepClosedMouldingLoop(outerLoop, config.width, config.relief, CLASSICAL_FRAME_PROFILE),
  )

  if (config.style === 'double-cadre') {
    const innerLoop = offsetPolygonInward(ccw, config.inset + Math.max(config.width * 1.65, 0.15))
    if (innerLoop) {
      parts.push(
        sweepClosedMouldingLoop(
          innerLoop,
          Math.max(0.025, config.width * 0.45),
          config.relief * 0.65,
          BAGUETTE_PROFILE,
        ),
      )
    }
  } else if (config.style === 'haussmann-cadre') {
    const gap = Math.max(config.width * 1.9, 0.17)
    const innerRaw = offsetPolygonInward(ccw, config.inset + gap)
    if (innerRaw) {
      const innerWidth = Math.max(0.025, config.width * 0.42)
      const innerRelief = config.relief * 0.65
      if (config.notchedCorners) {
        const { loop: notched, rosetteCenters } = notchHaussmannCorners(
          innerRaw,
          clamp(gap * 0.92, 0.1, 0.2),
        )
        parts.push(sweepClosedMouldingLoop(notched, innerWidth, innerRelief, BAGUETTE_PROFILE))
        const rosetteDiam = clamp(gap * 0.85, 0.12, 0.22)
        for (const center of rosetteCenters) {
          if (!pointInCeiling(center, polygon, holes)) continue
          parts.push(
            buildCeilingMedallionGeometry(
              { style: 'classique-godrons', diameter: rosetteDiam, relief: config.relief * 0.78 },
              center,
              { radialSegments: 18, angularSegments: 48 },
            ),
          )
        }
      } else {
        parts.push(sweepClosedMouldingLoop(innerRaw, innerWidth, innerRelief, BAGUETTE_PROFILE))
      }
    }
  } else if (config.style === 'caissons') {
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    for (const [x, z] of outerLoop) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const spanX = maxX - minX
    const spanZ = maxZ - minZ
    const baysX = clamp(Math.round(spanX / 1.65), 2, 6)
    const baysZ = clamp(Math.round(spanZ / 1.65), 2, 6)
    const ribW = Math.max(0.04, config.width * 0.85)
    const ribR = config.relief * 0.9
    for (let ix = 1; ix < baysX; ix++) {
      const x = minX + (spanX * ix) / baysX
      for (const [z0, z1] of clipLineToPolygon(outerLoop, 'x', x)) {
        const mid: Pt = [x, (z0 + z1) / 2]
        if (!pointInCeiling(mid, polygon, holes)) continue
        const rib = sweepStraightRib([x, z0], [x, z1], ribW, ribR, BAGUETTE_PROFILE)
        if (rib) parts.push(rib)
      }
    }
    for (let iz = 1; iz < baysZ; iz++) {
      const z = minZ + (spanZ * iz) / baysZ
      for (const [x0, x1] of clipLineToPolygon(outerLoop, 'z', z)) {
        const mid: Pt = [(x0 + x1) / 2, z]
        if (!pointInCeiling(mid, polygon, holes)) continue
        const rib = sweepStraightRib([x0, z], [x1, z], ribW, ribR, BAGUETTE_PROFILE)
        if (rib) parts.push(rib)
      }
    }
  }

  return mergeNormalized(parts)
}
