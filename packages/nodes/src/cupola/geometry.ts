import type { CupolaNode } from '@pascal-app/core'
import * as THREE from 'three'
import {
  copyUvToSecondaryChannel,
  cumulativeProfileDistances,
  type MetricUv,
  planarMetricUvs,
} from '../shared/primitive-uv'

export const CUPOLA_MATERIAL_INDEX = {
  base: 0,
  body: 1,
  roof: 2,
} as const

/**
 * Pure builder for the cupola mesh — a small louvered roof lantern:
 *
 *        ✦            ← finial (post + ball)
 *       /\
 *      /  \           ← roof (dome or pyramid)
 *     /____\
 *    |‖‖‖‖‖‖|          ← louvered body (angled slats on 4 faces)
 *    |‖‖‖‖‖‖|
 *   _|______|_
 *  |__________|        ← base plinth, seats on the roof
 *
 * Built bottom → top from primitive revolves / boxes. Every face is placed
 * through a winding-safe oriented quad/tri, so the whole thing is lit
 * correctly from outside without hand-traced winding.
 *
 * Pure: no React, no scene access, no store mutation. Safe for unit tests,
 * the placement preview, and the move-tool ghost.
 */
export function buildCupolaGeometry(node: CupolaNode): THREE.BufferGeometry {
  const w = Math.max(0.2, node.width)
  const d = Math.max(0.2, node.depth)
  const h = Math.max(0.3, node.height)
  const hw = w / 2
  const hd = d / 2

  // Vertical budget.
  const baseH = h * 0.05
  const bodyH = h * 0.42
  const corniceH = h * 0.06
  const roofH = h * 0.32
  const baseTop = baseH
  const bodyTop = baseTop + bodyH
  const corniceTop = bodyTop + corniceH
  const apexY = corniceTop + roofH

  // Footprints.
  const baseOvh = Math.min(hw, hd) * 0.12
  const cornOvh = Math.min(hw, hd) * 0.22

  const p: number[] = []
  const n: number[] = []
  const uv: number[] = []

  // Base plinth (slightly wider than the body) — closed box.
  addBox(p, n, uv, hw + baseOvh, hd + baseOvh, 0, baseTop)
  const baseEnd = p.length / 3
  // Body — closed box; the louvers are applied as relief on its walls.
  addBox(p, n, uv, hw, hd, baseTop, bodyTop)
  const bodyEnd = p.length / 3
  // Cornice — overhanging slab the roof sits on.
  addBox(p, n, uv, hw + cornOvh, hd + cornOvh, bodyTop, corniceTop)
  const corniceEnd = p.length / 3

  // Louvered slats on all four body faces.
  addLouvers(p, n, uv, hw, hd, baseTop, bodyTop)
  const louversEnd = p.length / 3

  // Roof.
  const rhw = hw + cornOvh
  const rhd = hd + cornOvh
  if (node.roofStyle === 'pyramid') {
    addPyramidRoof(p, n, uv, rhw, rhd, corniceTop, apexY)
  } else {
    addDomeRoof(p, n, uv, rhw, rhd, corniceTop, roofH)
  }

  // Finial: a short post topped by a ball.
  if (node.finial) {
    const ballR = Math.min(w, d) * 0.05
    const postR = ballR * 0.45
    const postTop = apexY + roofH * 0.18
    addCylinder(p, n, uv, postR, apexY, postTop)
    addSphere(p, n, uv, ballR, postTop + ballR * 0.7)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.addGroup(0, baseEnd, CUPOLA_MATERIAL_INDEX.base)
  geo.addGroup(baseEnd, bodyEnd - baseEnd, CUPOLA_MATERIAL_INDEX.body)
  geo.addGroup(bodyEnd, corniceEnd - bodyEnd, CUPOLA_MATERIAL_INDEX.roof)
  geo.addGroup(corniceEnd, louversEnd - corniceEnd, CUPOLA_MATERIAL_INDEX.body)
  geo.addGroup(louversEnd, p.length / 3 - louversEnd, CUPOLA_MATERIAL_INDEX.roof)
  copyUvToSecondaryChannel(geo)
  geo.computeBoundingSphere()
  return geo
}

// ─── Body / cornice / base ───────────────────────────────────────────

// Closed axis-aligned box centred on the Y axis in X/Z, spanning y0..y1.
function addBox(
  p: number[],
  n: number[],
  uv: number[],
  hw: number,
  hd: number,
  y0: number,
  y1: number,
): void {
  // Walls.
  pushQuad(p, n, uv, [hw, y0, -hd], [hw, y0, hd], [hw, y1, hd], [hw, y1, -hd], [1, 0, 0])
  pushQuad(p, n, uv, [-hw, y0, hd], [-hw, y0, -hd], [-hw, y1, -hd], [-hw, y1, hd], [-1, 0, 0])
  pushQuad(p, n, uv, [hw, y0, hd], [-hw, y0, hd], [-hw, y1, hd], [hw, y1, hd], [0, 0, 1])
  pushQuad(p, n, uv, [-hw, y0, -hd], [hw, y0, -hd], [hw, y1, -hd], [-hw, y1, -hd], [0, 0, -1])
  // Top + bottom.
  pushQuad(p, n, uv, [-hw, y1, -hd], [-hw, y1, hd], [hw, y1, hd], [hw, y1, -hd], [0, 1, 0])
  pushQuad(p, n, uv, [-hw, y0, -hd], [hw, y0, -hd], [hw, y0, hd], [-hw, y0, hd], [0, -1, 0])
}

// ─── Louvers ─────────────────────────────────────────────────────────
// Angled slats standing proud of each body face. Each slat is a double-
// sided angled quad (emitted twice with opposite hints) so it reads from
// both above and below. The solid body wall behind them blocks see-through.

const SLAT_COUNT = 5

function addLouvers(
  p: number[],
  n: number[],
  uv: number[],
  hw: number,
  hd: number,
  y0: number,
  y1: number,
): void {
  // Each face: a local→world mapper map(u, y, out) and the slat half-width.
  const faces: Array<{ map: (u: number, y: number, out: number) => number[]; halfU: number }> = [
    { map: (u, y, out) => [u, y, hd + out], halfU: hw * 0.82 }, // +Z
    { map: (u, y, out) => [u, y, -(hd + out)], halfU: hw * 0.82 }, // -Z
    { map: (u, y, out) => [hw + out, y, u], halfU: hd * 0.82 }, // +X
    { map: (u, y, out) => [-(hw + out), y, u], halfU: hd * 0.82 }, // -X
  ]

  const margin = (y1 - y0) * 0.12
  const top = y1 - margin
  const bottom = y0 + margin
  const span = top - bottom
  const drop = span / (SLAT_COUNT + 1)
  const proj = drop * 0.9

  for (const { map, halfU } of faces) {
    const outDir = sub(map(0, 0, 1), map(0, 0, 0))
    const upOut: number[] = [outDir[0]!, 1, outDir[2]!]
    const downOut: number[] = [outDir[0]!, -1, outDir[2]!]
    for (let k = 1; k <= SLAT_COUNT; k++) {
      const yTop = bottom + (span * k) / SLAT_COUNT
      const a = map(-halfU, yTop, 0)
      const b = map(halfU, yTop, 0)
      const c = map(halfU, yTop - drop, proj)
      const dd = map(-halfU, yTop - drop, proj)
      // Top + underside of the slat.
      pushQuad(p, n, uv, a, b, c, dd, upOut)
      pushQuad(p, n, uv, a, b, c, dd, downOut)
    }
  }
}

// ─── Roofs ───────────────────────────────────────────────────────────

function addPyramidRoof(
  p: number[],
  n: number[],
  uv: number[],
  hw: number,
  hd: number,
  y0: number,
  apexY: number,
): void {
  const apex = [0, apexY, 0]
  const corners = [
    [hw, y0, -hd],
    [hw, y0, hd],
    [-hw, y0, hd],
    [-hw, y0, -hd],
  ]
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!
    const b = corners[(i + 1) % 4]!
    // Outward + up hint from the edge midpoint.
    const mx = (a[0]! + b[0]!) / 2
    const mz = (a[2]! + b[2]!) / 2
    pushTri(p, n, uv, a, b, apex, [mx, Math.max(hw, hd), mz])
  }
}

function addDomeRoof(
  p: number[],
  n: number[],
  uv: number[],
  rx: number,
  rz: number,
  y0: number,
  domeH: number,
): void {
  const lng = 20
  const lat = 6
  let prev = ringAt(rx, rz, y0, lng)
  let prevU = cumulativeProfileDistances(prev)
  let domeV = 0
  for (let i = 1; i <= lat; i++) {
    const phi = (Math.PI / 2) * (i / lat)
    const rf = Math.cos(phi)
    const y = y0 + domeH * Math.sin(phi)
    const ring = ringAt(rx * rf, rz * rf, y, lng)
    const ringU = cumulativeProfileDistances(ring)
    const nextV = domeV + averageProfileDistance(prev, ring)
    addBand(
      p,
      n,
      uv,
      prev,
      ring,
      lng,
      (a, _b, c) => {
        const x = (a[0]! + c[0]!) / 2
        const yy = (a[1]! + c[1]!) / 2 - y0
        const z = (a[2]! + c[2]!) / 2
        return [x, yy, z]
      },
      prevU,
      ringU,
      domeV,
      nextV,
    )
    prev = ring
    prevU = ringU
    domeV = nextV
  }
}

// ─── Finial primitives ───────────────────────────────────────────────

function addCylinder(
  p: number[],
  n: number[],
  uv: number[],
  r: number,
  y0: number,
  y1: number,
): void {
  const lng = 12
  const bottom = ringAt(r, r, y0, lng)
  const top = ringAt(r, r, y1, lng)
  const ringU = cumulativeProfileDistances(bottom)
  addBand(
    p,
    n,
    uv,
    bottom,
    top,
    lng,
    (a, _b, c) => {
      const x = (a[0]! + c[0]!) / 2
      const z = (a[2]! + c[2]!) / 2
      return [x, 0, z]
    },
    ringU,
    ringU,
    y0,
    y1,
  )
}

function addSphere(p: number[], n: number[], uv: number[], r: number, cy: number): void {
  const lng = 14
  const lat = 8
  let prev = ringAt(0, 0, cy - r, lng)
  let prevU = cumulativeProfileDistances(prev)
  let sphereV = 0
  for (let i = 1; i <= lat; i++) {
    const theta = Math.PI * (i / lat) - Math.PI / 2
    const ry = r * Math.sin(theta)
    const rr = r * Math.cos(theta)
    const ring = ringAt(rr, rr, cy + ry, lng)
    const ringU = cumulativeProfileDistances(ring)
    const nextV = sphereV + averageProfileDistance(prev, ring)
    addBand(
      p,
      n,
      uv,
      prev,
      ring,
      lng,
      (a, _b, c) => {
        const x = (a[0]! + c[0]!) / 2
        const yy = (a[1]! + c[1]!) / 2 - cy
        const z = (a[2]! + c[2]!) / 2
        return [x, yy, z]
      },
      prevU,
      ringU,
      sphereV,
      nextV,
    )
    prev = ring
    prevU = ringU
    sphereV = nextV
  }
}

// ─── Revolve plumbing ────────────────────────────────────────────────

function ringAt(ax: number, az: number, y: number, lng: number): number[][] {
  const row: number[][] = []
  for (let j = 0; j <= lng; j++) {
    const t = (Math.PI * 2 * j) / lng
    row.push([ax * Math.cos(t), y, az * Math.sin(t)])
  }
  return row
}

function addBand(
  p: number[],
  n: number[],
  uv: number[],
  rA: number[][],
  rB: number[][],
  lng: number,
  hintFn: (a: number[], b: number[], c: number[], d: number[]) => number[],
  uA = cumulativeProfileDistances(rA),
  uB = cumulativeProfileDistances(rB),
  vA = 0,
  vB = averageProfileDistance(rA, rB),
): void {
  for (let j = 0; j < lng; j++) {
    const a = rA[j]!
    const b = rA[j + 1]!
    const c = rB[j + 1]!
    const d = rB[j]!
    pushQuad(p, n, uv, a, b, c, d, hintFn(a, b, c, d), [
      [uA[j]!, vA],
      [uA[j + 1]!, vA],
      [uB[j + 1]!, vB],
      [uB[j]!, vB],
    ])
  }
}

function averageProfileDistance(a: number[][], b: number[][]): number {
  let total = 0
  for (let index = 0; index < a.length; index += 1) {
    total += Math.hypot(
      b[index]![0]! - a[index]![0]!,
      b[index]![1]! - a[index]![1]!,
      b[index]![2]! - a[index]![2]!,
    )
  }
  return total / a.length
}

function sub(a: number[], b: number[]): number[] {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]
}

// ─── Winding-safe primitives ─────────────────────────────────────────

function pushQuad(
  positions: number[],
  normals: number[],
  uvs: number[],
  a: number[],
  b: number[],
  c: number[],
  d: number[],
  hint: number[],
  authoredUvs?: readonly MetricUv[],
) {
  let nx = (c[1]! - a[1]!) * (b[2]! - a[2]!) - (c[2]! - a[2]!) * (b[1]! - a[1]!)
  let ny = (c[2]! - a[2]!) * (b[0]! - a[0]!) - (c[0]! - a[0]!) * (b[2]! - a[2]!)
  let nz = (c[0]! - a[0]!) * (b[1]! - a[1]!) - (c[1]! - a[1]!) * (b[0]! - a[0]!)
  const flip = nx * hint[0]! + ny * hint[1]! + nz * hint[2]! < 0
  if (flip) {
    nx = -nx
    ny = -ny
    nz = -nz
  }
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
  nx /= len
  ny /= len
  nz /= len

  const faceUvs = authoredUvs ?? planarMetricUvs([a, b, c, d], [nx, ny, nz])
  const [uvA, uvB, uvC, uvD] = faceUvs as readonly [MetricUv, MetricUv, MetricUv, MetricUv]

  if (flip) {
    positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
    uvs.push(...uvA, ...uvB, ...uvC)
    positions.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, d[0]!, d[1]!, d[2]!)
    uvs.push(...uvA, ...uvC, ...uvD)
  } else {
    positions.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, b[0]!, b[1]!, b[2]!)
    uvs.push(...uvA, ...uvC, ...uvB)
    positions.push(a[0]!, a[1]!, a[2]!, d[0]!, d[1]!, d[2]!, c[0]!, c[1]!, c[2]!)
    uvs.push(...uvA, ...uvD, ...uvC)
  }
  for (let i = 0; i < 6; i++) normals.push(nx, ny, nz)
}

function pushTri(
  positions: number[],
  normals: number[],
  uvs: number[],
  a: number[],
  b: number[],
  c: number[],
  hint: number[],
) {
  let nx = (b[1]! - a[1]!) * (c[2]! - a[2]!) - (b[2]! - a[2]!) * (c[1]! - a[1]!)
  let ny = (b[2]! - a[2]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[2]! - a[2]!)
  let nz = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!)
  const flip = nx * hint[0]! + ny * hint[1]! + nz * hint[2]! < 0
  if (flip) {
    nx = -nx
    ny = -ny
    nz = -nz
  }
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
  nx /= len
  ny /= len
  nz /= len

  const faceUvs = planarMetricUvs([a, b, c], [nx, ny, nz])
  const uvA = faceUvs[0]!
  const uvB = faceUvs[1]!
  const uvC = faceUvs[2]!
  if (flip) {
    positions.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, b[0]!, b[1]!, b[2]!)
    uvs.push(...uvA, ...uvC, ...uvB)
  } else {
    positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
    uvs.push(...uvA, ...uvB, ...uvC)
  }
  for (let i = 0; i < 3; i++) normals.push(nx, ny, nz)
}
