import type { TurbineVentNode } from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Pure builders for the turbine vent (whirlybird). The mesh is split into
 * two pieces so the renderer can spin the head independently:
 *
 *   buildTurbineVentBase → flange flashing + throat        (STATIC)
 *   buildTurbineVentHead → finned head + top cap + knob     (SPINS, head-local)
 *   buildTurbineVentGeometry → base + head merged           (preview / tests, no spin)
 *
 * The head is authored in its own local frame with y = 0 at the bottom of
 * the head, so the renderer mounts it at `position={[0, neckHeight, 0]}`
 * and rotates it about its own vertical axis.
 *
 *        ___        ← top knob
 *       /◍◍◍\       ← curved vanes on a globe / cylinder profile (the head)
 *       \◍◍◍/
 *        | |        ← throat
 *       _| |_
 *      |_____|      ← flange flashing
 *
 * Pure: no React, no scene access, no store mutation. Safe for unit tests,
 * the placement preview, and the move-tool ghost.
 */

interface Dims {
  ro: number
  neckH: number
  headH: number
  throatR: number
  flangeR: number
  vanes: number
  thk: number
}

function resolveDims(node: TurbineVentNode): Dims {
  const ro = Math.max(0.05, node.diameter / 2)
  const height = Math.max(0.12, node.height)
  const neckH = Math.max(0.02, Math.min(node.neckHeight ?? 0.09, height * 0.5))
  const headH = height - neckH
  const throatR = ro * 0.82
  const flangeR = ro + Math.max(0, node.baseOverhang ?? 0.05)
  const vanes = Math.max(6, Math.min(36, Math.round(node.vaneCount ?? 20)))
  // Radial blade thickness — scales gently with size so wide turbines
  // don't read paper-thin.
  const thk = Math.max(0.004, ro * 0.03)
  return { ro, neckH, headH, throatR, flangeR, vanes, thk }
}

// ─── Public builders ─────────────────────────────────────────────────

export function buildTurbineVentBase(node: TurbineVentNode): THREE.BufferGeometry {
  const d = resolveDims(node)
  const p: number[] = []
  const n: number[] = []
  const uv: number[] = []

  const flangeThk = Math.min(0.012, d.neckH * 0.5)
  // Flange flashing — a thin disc the throat sits on.
  cylinderWall(p, n, uv, d.flangeR, 0, flangeThk, 32)
  disc(p, n, uv, d.flangeR, flangeThk, [0, 1, 0]) // flange top
  disc(p, n, uv, d.flangeR, 0, [0, -1, 0]) // flange underside
  // Throat — the tube the head rides on.
  cylinderWall(p, n, uv, d.throatR, flangeThk, d.neckH, 28)
  // Cap the throat top so you can't see down the tube past the head.
  disc(p, n, uv, d.throatR, d.neckH, [0, 1, 0])

  return toGeometry(p, n, uv)
}

export function buildTurbineVentHead(node: TurbineVentNode): THREE.BufferGeometry {
  const d = resolveDims(node)
  const p: number[] = []
  const n: number[] = []
  const uv: number[] = []

  const hubR = d.ro * 0.55
  const rings = vaneRings(node, d)
  const ringBottomY = rings[0]!.y

  // Lower hub — short cylinder closing the underside of the head over the
  // throat, so the spinning head reads as solid from below.
  cylinderWall(p, n, uv, hubR, 0, ringBottomY, 24)
  disc(p, n, uv, hubR, 0, [0, -1, 0])

  // Vanes.
  const dTheta = (Math.PI * 2) / d.vanes
  const dw = dTheta * 0.55
  const totalTwist = dTheta * 0.9
  buildVanes(p, n, uv, d.vanes, rings, dw, totalTwist, d.thk)

  // Top cap + spindle knob.
  const topRing = rings[rings.length - 1]!
  if (node.style === 'cylinder') {
    // Straight barrel → flat disc lid with a slim rim.
    const lidY = topRing.y
    cylinderWall(p, n, uv, topRing.r, lidY, lidY + d.headH * 0.04, 28)
    disc(p, n, uv, topRing.r, lidY + d.headH * 0.04, [0, 1, 0])
    knob(p, n, uv, d.ro, lidY + d.headH * 0.04, d.headH)
  } else {
    // Globe → domed lid for the spherical whirlybird silhouette.
    const apexY = d.headH * 0.96
    dome(p, n, uv, topRing.r, topRing.y, apexY - topRing.y, 5, 24)
    knob(p, n, uv, d.ro, apexY, d.headH)
  }

  return toGeometry(p, n, uv)
}

export function buildTurbineVentGeometry(node: TurbineVentNode): THREE.BufferGeometry {
  const d = resolveDims(node)
  const base = buildTurbineVentBase(node)
  const head = buildTurbineVentHead(node)
  head.translate(0, d.neckH, 0)
  const merged = mergeGeometries([base, head], false)
  base.dispose()
  head.dispose()
  return merged ?? buildTurbineVentBase(node)
}

// ─── Vane profile ────────────────────────────────────────────────────
// The head's vanes are lofted between these rings (bottom → top). `globe`
// bulges at the equator and narrows top + bottom; `cylinder` holds a
// constant radius for a straight barrel.

function vaneRings(node: TurbineVentNode, d: Dims): Array<{ r: number; y: number }> {
  if (node.style === 'cylinder') {
    return [
      { r: d.ro, y: d.headH * 0.04 },
      { r: d.ro, y: d.headH * 0.85 },
    ]
  }
  return [
    { r: d.ro * 0.6, y: d.headH * 0.05 },
    { r: d.ro, y: d.headH * 0.42 },
    { r: d.ro * 0.58, y: d.headH * 0.72 },
  ]
}

// Each vane is a thin, twisted shell lofted through `rings`: an outer and
// inner surface joined by edge strips, plus bottom + top caps. The twist
// from bottom to top is what reads as the scoop that catches the wind.
function buildVanes(
  p: number[],
  n: number[],
  uv: number[],
  count: number,
  rings: Array<{ r: number; y: number }>,
  dw: number,
  totalTwist: number,
  thk: number,
): void {
  const y0 = rings[0]!.y
  const span = rings[rings.length - 1]!.y - y0 || 1
  const K = rings.length

  for (let i = 0; i < count; i++) {
    const a0 = i * ((Math.PI * 2) / count)
    const oLo: THREE.Vector3[] = []
    const oHi: THREE.Vector3[] = []
    const iLo: THREE.Vector3[] = []
    const iHi: THREE.Vector3[] = []
    for (let k = 0; k < K; k++) {
      const ring = rings[k]!
      const t = (ring.y - y0) / span
      const tw = totalTwist * t
      const loA = a0 + tw
      const hiA = a0 + tw + dw
      oLo.push(polar(loA, ring.r, ring.y))
      oHi.push(polar(hiA, ring.r, ring.y))
      iLo.push(polar(loA, ring.r - thk, ring.y))
      iHi.push(polar(hiA, ring.r - thk, ring.y))
    }

    const midA = a0 + totalTwist * 0.5 + dw * 0.5
    const out: [number, number, number] = [Math.cos(midA), 0, Math.sin(midA)]
    const inward: [number, number, number] = [-out[0], 0, -out[2]]
    // Tangential directions for the two angular edges.
    const left: [number, number, number] = [Math.sin(midA), 0, -Math.cos(midA)]
    const right: [number, number, number] = [-left[0], 0, -left[2]]

    for (let k = 0; k < K - 1; k++) {
      // Outer + inner faces.
      pushQuad(p, n, uv, oLo[k]!, oHi[k]!, oHi[k + 1]!, oLo[k + 1]!, out)
      pushQuad(p, n, uv, iLo[k]!, iHi[k]!, iHi[k + 1]!, iLo[k + 1]!, inward)
      // Angular edges (lo side / hi side).
      pushQuad(p, n, uv, oLo[k]!, iLo[k]!, iLo[k + 1]!, oLo[k + 1]!, left)
      pushQuad(p, n, uv, oHi[k]!, iHi[k]!, iHi[k + 1]!, oHi[k + 1]!, right)
    }
    // Bottom + top caps.
    pushQuad(p, n, uv, oLo[0]!, oHi[0]!, iHi[0]!, iLo[0]!, [0, -1, 0])
    pushQuad(p, n, uv, oLo[K - 1]!, oHi[K - 1]!, iHi[K - 1]!, iLo[K - 1]!, [0, 1, 0])
  }
}

// ─── Primitive builders ──────────────────────────────────────────────

function cylinderWall(
  p: number[],
  n: number[],
  uv: number[],
  r: number,
  y0: number,
  y1: number,
  segs: number,
): void {
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2
    const b = ((i + 1) / segs) * Math.PI * 2
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const cb = Math.cos(b)
    const sb = Math.sin(b)
    const out: [number, number, number] = [Math.cos((a + b) / 2), 0, Math.sin((a + b) / 2)]
    pushQuad(
      p,
      n,
      uv,
      [r * ca, y0, r * sa],
      [r * cb, y0, r * sb],
      [r * cb, y1, r * sb],
      [r * ca, y1, r * sa],
      out,
    )
  }
}

function disc(
  p: number[],
  n: number[],
  uv: number[],
  r: number,
  y: number,
  hint: [number, number, number],
  segs = 32,
): void {
  const center = new THREE.Vector3(0, y, 0)
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2
    const b = ((i + 1) / segs) * Math.PI * 2
    pushTri(p, n, uv, center, polar(a, r, y), polar(b, r, y), hint)
  }
}

// Half-ellipsoid cap: base radius `rb` at `y0`, apex `hd` above it.
function dome(
  p: number[],
  n: number[],
  uv: number[],
  rb: number,
  y0: number,
  hd: number,
  lat: number,
  lng: number,
): void {
  const grid: THREE.Vector3[][] = []
  for (let i = 0; i <= lat; i++) {
    const phi = (Math.PI / 2) * (i / lat)
    const r = rb * Math.cos(phi)
    const y = y0 + hd * Math.sin(phi)
    const row: THREE.Vector3[] = []
    for (let j = 0; j <= lng; j++) {
      const theta = (j / lng) * Math.PI * 2
      row.push(new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)))
    }
    grid.push(row)
  }
  const center = new THREE.Vector3(0, y0, 0)
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lng; j++) {
      const a = grid[i]![j]!
      const b = grid[i]![j + 1]!
      const c = grid[i + 1]![j + 1]!
      const d = grid[i + 1]![j]!
      const mid = new THREE.Vector3().add(a).add(b).add(c).add(d).multiplyScalar(0.25)
      const hint = mid.clone().sub(center).normalize()
      pushQuad(p, n, uv, a, b, c, d, [hint.x, hint.y, hint.z])
    }
  }
}

// Small spindle knob at the top centre.
function knob(p: number[], n: number[], uv: number[], ro: number, y0: number, headH: number): void {
  const kr = ro * 0.12
  const kh = headH * 0.06
  cylinderWall(p, n, uv, kr, y0, y0 + kh, 12)
  dome(p, n, uv, kr, y0 + kh, kr * 0.9, 3, 12)
}

// ─── Geometry plumbing ───────────────────────────────────────────────

function polar(angle: number, r: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(r * Math.cos(angle), y, r * Math.sin(angle))
}

function v(point: THREE.Vector3 | number[]): [number, number, number] {
  if (Array.isArray(point)) return [point[0]!, point[1]!, point[2]!]
  return [point.x, point.y, point.z]
}

// Winding-safe quad: triangulates (a,b,c,d) and orients both triangles so
// their shared flat normal points toward `hint`. Front faces are then
// always visible from the intended side under a FrontSide material — no
// hand-traced winding to get wrong. UVs are dimension-based so painted
// presets tile at a consistent world density across the body and vanes.
function pushQuad(
  positions: number[],
  normals: number[],
  uvs: number[],
  ap: THREE.Vector3 | number[],
  bp: THREE.Vector3 | number[],
  cp: THREE.Vector3 | number[],
  dp: THREE.Vector3 | number[],
  hint: [number, number, number],
): void {
  const a = v(ap)
  const b = v(bp)
  const c = v(cp)
  const d = v(dp)
  // Normal of triangle (a, c, b): (c-a) × (b-a).
  let nx = (c[1]! - a[1]!) * (b[2]! - a[2]!) - (c[2]! - a[2]!) * (b[1]! - a[1]!)
  let ny = (c[2]! - a[2]!) * (b[0]! - a[0]!) - (c[0]! - a[0]!) * (b[2]! - a[2]!)
  let nz = (c[0]! - a[0]!) * (b[1]! - a[1]!) - (c[1]! - a[1]!) * (b[0]! - a[0]!)
  const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0
  if (flip) {
    nx = -nx
    ny = -ny
    nz = -nz
  }
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
  nx /= len
  ny /= len
  nz /= len

  const abx = b[0]! - a[0]!
  const aby = b[1]! - a[1]!
  const abz = b[2]! - a[2]!
  const adx = d[0]! - a[0]!
  const ady = d[1]! - a[1]!
  const adz = d[2]! - a[2]!
  const u = Math.sqrt(abx * abx + aby * aby + abz * abz)
  const vv = Math.sqrt(adx * adx + ady * ady + adz * adz)

  if (flip) {
    // Reversed winding: (a,b,c) + (a,c,d).
    positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
    uvs.push(0, 0, u, 0, u, vv)
    positions.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, d[0]!, d[1]!, d[2]!)
    uvs.push(0, 0, u, vv, 0, vv)
  } else {
    // Default winding: (a,c,b) + (a,d,c).
    positions.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, b[0]!, b[1]!, b[2]!)
    uvs.push(0, 0, u, vv, u, 0)
    positions.push(a[0]!, a[1]!, a[2]!, d[0]!, d[1]!, d[2]!, c[0]!, c[1]!, c[2]!)
    uvs.push(0, 0, 0, vv, u, vv)
  }
  for (let i = 0; i < 6; i++) normals.push(nx, ny, nz)
}

function pushTri(
  positions: number[],
  normals: number[],
  uvs: number[],
  ap: THREE.Vector3 | number[],
  bp: THREE.Vector3 | number[],
  cp: THREE.Vector3 | number[],
  hint: [number, number, number],
): void {
  const a = v(ap)
  const b = v(bp)
  const c = v(cp)
  let nx = (b[1]! - a[1]!) * (c[2]! - a[2]!) - (b[2]! - a[2]!) * (c[1]! - a[1]!)
  let ny = (b[2]! - a[2]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[2]! - a[2]!)
  let nz = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!)
  const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0
  if (flip) {
    nx = -nx
    ny = -ny
    nz = -nz
  }
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
  nx /= len
  ny /= len
  nz /= len

  if (flip) {
    positions.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, b[0]!, b[1]!, b[2]!)
  } else {
    positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  }
  uvs.push(0, 0, 1, 0, 0, 1)
  for (let i = 0; i < 3; i++) normals.push(nx, ny, nz)
}

function toGeometry(positions: number[], normals: number[], uvs: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.computeBoundingSphere()
  return geo
}
