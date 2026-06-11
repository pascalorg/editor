import type { CupolaNode } from '@pascal-app/core'
import * as THREE from 'three'

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
  // Body — closed box; the louvers are applied as relief on its walls.
  addBox(p, n, uv, hw, hd, baseTop, bodyTop)
  // Cornice — overhanging slab the roof sits on.
  addBox(p, n, uv, hw + cornOvh, hd + cornOvh, bodyTop, corniceTop)

  // Louvered slats on all four body faces.
  addLouvers(p, n, uv, hw, hd, baseTop, bodyTop)

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
  for (let i = 1; i <= lat; i++) {
    const phi = (Math.PI / 2) * (i / lat)
    const rf = Math.cos(phi)
    const y = y0 + domeH * Math.sin(phi)
    const ring = ringAt(rx * rf, rz * rf, y, lng)
    addBand(p, n, uv, prev, ring, lng, (a, _b, c) => {
      const x = (a[0]! + c[0]!) / 2
      const yy = (a[1]! + c[1]!) / 2 - y0
      const z = (a[2]! + c[2]!) / 2
      return [x, yy, z]
    })
    prev = ring
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
  addBand(p, n, uv, bottom, top, lng, (a, _b, c) => {
    const x = (a[0]! + c[0]!) / 2
    const z = (a[2]! + c[2]!) / 2
    return [x, 0, z]
  })
}

function addSphere(p: number[], n: number[], uv: number[], r: number, cy: number): void {
  const lng = 14
  const lat = 8
  let prev = ringAt(0, 0, cy - r, lng)
  for (let i = 1; i <= lat; i++) {
    const theta = Math.PI * (i / lat) - Math.PI / 2
    const ry = r * Math.sin(theta)
    const rr = r * Math.cos(theta)
    const ring = ringAt(rr, rr, cy + ry, lng)
    addBand(p, n, uv, prev, ring, lng, (a, _b, c) => {
      const x = (a[0]! + c[0]!) / 2
      const yy = (a[1]! + c[1]!) / 2 - cy
      const z = (a[2]! + c[2]!) / 2
      return [x, yy, z]
    })
    prev = ring
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
): void {
  for (let j = 0; j < lng; j++) {
    const a = rA[j]!
    const b = rA[j + 1]!
    const c = rB[j + 1]!
    const d = rB[j]!
    pushQuad(p, n, uv, a, b, c, d, hintFn(a, b, c, d))
  }
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

  const u = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!)
  const v = Math.hypot(d[0]! - a[0]!, d[1]! - a[1]!, d[2]! - a[2]!)

  if (flip) {
    positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
    uvs.push(0, 0, u, 0, u, v)
    positions.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, d[0]!, d[1]!, d[2]!)
    uvs.push(0, 0, u, v, 0, v)
  } else {
    positions.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, b[0]!, b[1]!, b[2]!)
    uvs.push(0, 0, u, v, u, 0)
    positions.push(a[0]!, a[1]!, a[2]!, d[0]!, d[1]!, d[2]!, c[0]!, c[1]!, c[2]!)
    uvs.push(0, 0, 0, v, u, v)
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

  if (flip) {
    positions.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, b[0]!, b[1]!, b[2]!)
  } else {
    positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  }
  uvs.push(0, 0, 1, 0, 0, 1)
  for (let i = 0; i < 3; i++) normals.push(nx, ny, nz)
}
