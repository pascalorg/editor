import type { EyebrowVentNode } from '@pascal-app/core'
import * as THREE from 'three'

/**
 * Pure builder for the eyebrow-vent mesh. Three styles, all seated directly on
 * the roof at y=0 and facing +Z (downslope):
 *
 *  - `scoop`      — a rounded louvered opening at the front that sweeps back
 *                   and tapers to nothing (the classic dormer "eyebrow"). Front
 *                   = a half-ellipse of horizontal louvers; the body is a lofted
 *                   half-cone with a rounded nose.
 *  - `half-round` — a D-shaped half-round vent: a constant half-ellipse cross
 *                   section extruded a short depth, flat louvered front face,
 *                   capped back, curved top.
 *  - `slant-box`  — a low box with a slanted top (tall front, lower back) and a
 *                   framed front face holding recessed louvers + a screen.
 *
 * Every face is emitted through a winding-safe oriented quad/tri, the louvers
 * are extruded into solid slabs, and the whole mesh is double-sided at the end
 * (see `doubleSide`) so it reads correctly from any angle.
 *
 * Pure: no React, no scene access, no store mutation. Safe for unit tests, the
 * placement preview, and the move-tool ghost.
 */
export function buildEyebrowVentGeometry(node: EyebrowVentNode): THREE.BufferGeometry {
  const w = Math.max(0.15, node.width)
  const d = Math.max(0.15, node.depth)
  const h = Math.max(0.06, node.height)
  const slats = Math.max(0, Math.min(8, Math.round(node.louverCount ?? 3)))
  // slant-box: the low rear edge as a fraction of the tall front edge.
  const backRatio = Math.max(0.15, Math.min(1, node.backRatio ?? 0.5))

  const p: number[] = []
  const n: number[] = []
  const uv: number[] = []

  // The hood seats directly on the roof at y=0 — no flashing plate.
  if (node.style === 'half-round') {
    addHalfRound(p, n, uv, w, d, h, 0, slats)
  } else if (node.style === 'slant-box') {
    addSlantBox(p, n, uv, w, d, h, 0, slats, backRatio)
  } else {
    addScoop(p, n, uv, w, d, h, 0, slats)
  }

  // Double-side the whole mesh at the geometry level: append a back-facing
  // copy of every triangle (reversed winding + negated normals). The open
  // shells (scoop hood, half-round dome, slant-box pocket) then read as solid
  // from inside too, lit correctly from both sides — without a `DoubleSide`
  // material, which poisons the MRT scene pass (see the ridge-vent renderer
  // note). Only one of each coplanar pair front-faces any camera, so there's
  // no z-fighting.
  doubleSide(p, n, uv)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.computeBoundingSphere()
  return geo
}

// ─── Style: scoop (the eyebrow) ───────────────────────────────────────────

function addScoop(
  p: number[],
  n: number[],
  uv: number[],
  w: number,
  d: number,
  h: number,
  yB: number,
  slats: number,
): void {
  const a = w / 2
  const b = h
  const zF = d / 2
  const NZ = 20
  const NF = 18

  // Lofted half-ellipse, full at the front (z = zF) tapering to a rounded
  // nose at the back. `cos(v·π/2)` gives a smooth falloff to zero.
  const rings: number[][][] = []
  for (let i = 0; i <= NZ; i++) {
    const v = i / NZ
    const scale = Math.cos((v * Math.PI) / 2)
    const z = zF - v * d
    rings.push(halfRing(a, b, yB, z, scale, NF))
  }
  for (let i = 0; i < NZ; i++) {
    addBand(p, n, uv, rings[i + 1]!, rings[i]!, NF, (qa, qb, qc, qd) => {
      const mx = (qa[0]! + qb[0]! + qc[0]! + qd[0]!) / 4
      const my = (qa[1]! + qb[1]! + qc[1]! + qd[1]!) / 4
      return [mx, my - yB, 0] // radial-out from the spine
    })
  }

  // Horizontal louvers filling the front half-ellipse opening.
  addArchLouvers(p, n, uv, a, b, yB, zF - d * 0.04, slats)
}

// ─── Style: half-round (D-shaped louver vent) ─────────────────────────────

function addHalfRound(
  p: number[],
  n: number[],
  uv: number[],
  w: number,
  d: number,
  h: number,
  yB: number,
  slats: number,
): void {
  const a = w / 2
  // Cap the crown at a true half-round — never bulge past a semicircle, so the
  // top reads as a clean, smaller-radius arch. `height` flattens it further.
  const b = Math.min(h, a)
  const zF = d / 2
  const zB = -d / 2
  const NF = 20

  const ringF = halfRing(a, b, yB, zF, 1, NF)
  const ringB = halfRing(a, b, yB, zB, 1, NF)

  // Curved top shell (constant cross section).
  addBand(p, n, uv, ringB, ringF, NF, (qa, qb, qc, qd) => {
    const mx = (qa[0]! + qb[0]! + qc[0]! + qd[0]!) / 4
    const my = (qa[1]! + qb[1]! + qc[1]! + qd[1]!) / 4
    return [mx, my - yB, 0]
  })

  // Back cap — fan the rear semicircle, facing -Z.
  const backCenter = [0, yB, zB]
  for (let j = 0; j < NF; j++) {
    pushTri(p, n, uv, backCenter, ringB[j + 1]!, ringB[j]!, [0, 0, -1])
  }

  // Louvered front face (a slat count bumped up — the D-vent reads denser).
  addArchLouvers(p, n, uv, a, b, yB, zF - d * 0.04, slats > 0 ? Math.max(slats, 4) : 0)
}

// ─── Style: slant-box (low hooded box) ────────────────────────────────────

function addSlantBox(
  p: number[],
  n: number[],
  uv: number[],
  w: number,
  d: number,
  h: number,
  yB: number,
  slats: number,
  backRatio: number,
): void {
  const hw = w / 2
  const zF = d / 2
  const zB = -d / 2
  const yFront = yB + h // tall front — the louvered/screened opening
  const yBack = yB + h * backRatio // lower at the back, top slopes down to it

  // Corner shorthands.
  const fbl = [-hw, yB, zF]
  const fbr = [hw, yB, zF]
  const ftl = [-hw, yFront, zF]
  const ftr = [hw, yFront, zF]
  const bbl = [-hw, yB, zB]
  const bbr = [hw, yB, zB]
  const btl = [-hw, yBack, zB]
  const btr = [hw, yBack, zB]

  // Sides (trapezoids), slanted top, back wall.
  pushQuad(p, n, uv, fbr, bbr, btr, ftr, [1, 0, 0])
  pushQuad(p, n, uv, bbl, fbl, ftl, btl, [-1, 0, 0])
  pushQuad(p, n, uv, ftl, ftr, btr, btl, [0, 1, 0])
  pushQuad(p, n, uv, bbl, bbr, btr, btl, [0, 0, -1])

  // Front frame: a face plate at z = zF with a rectangular hole. The louvers
  // and screen live RECESSED inside that hole, so they're fully contained by
  // the box — never poking out past the front face or above the opening.
  const frame = Math.min(0.04, Math.min(w, h) * 0.14)
  const oL = -hw + frame
  const oR = hw - frame
  const oB = yB + frame
  const oT = yFront - frame
  // Four frame rails around the opening (front face, +Z).
  pushQuad(p, n, uv, [-hw, oT, zF], [hw, oT, zF], ftr, ftl, [0, 0, 1]) // top
  pushQuad(p, n, uv, fbl, fbr, [hw, oB, zF], [-hw, oB, zF], [0, 0, 1]) // bottom
  pushQuad(p, n, uv, [-hw, oB, zF], [oL, oB, zF], [oL, oT, zF], [-hw, oT, zF], [0, 0, 1]) // left
  pushQuad(p, n, uv, [oR, oB, zF], [hw, oB, zF], [hw, oT, zF], [oR, oT, zF], [0, 0, 1]) // right

  // Recessed screen panel at the back of the pocket (blocks see-through).
  const screenZ = zF - d * 0.2
  pushQuad(
    p,
    n,
    uv,
    [oL, oB, screenZ],
    [oR, oB, screenZ],
    [oR, oT, screenZ],
    [oL, oT, screenZ],
    [0, 0, 1],
  )

  // Horizontal louvers inside the pocket — bounded by the opening in height
  // and recessed in depth between the frame face and the screen.
  addRectLouvers(p, n, uv, oR, oB, oT, zF - d * 0.07, slats)
}

// ─── Louver helpers ───────────────────────────────────────────────────────

// Angled horizontal slats filling a half-ellipse opening (radius a × b,
// flat side on the plate at `yB`), set just inside the face at `z`.
function addArchLouvers(
  p: number[],
  n: number[],
  uv: number[],
  a: number,
  b: number,
  yB: number,
  z: number,
  slats: number,
): void {
  if (slats <= 0) return
  const drop = (b / (slats + 1)) * 0.55
  const back = Math.max(0.012, b * 0.12)
  const thick = Math.max(0.004, drop * 0.32)
  for (let k = 1; k <= slats; k++) {
    const s = k / (slats + 1) // height fraction up the semicircle (sin φ)
    const y = yB + b * s
    const halfX = a * Math.sqrt(Math.max(0, 1 - s * s)) * 0.96
    if (halfX < 1e-3) continue
    addSlab(
      p,
      n,
      uv,
      [-halfX, y, z],
      [halfX, y, z],
      [halfX, y - drop, z - back],
      [-halfX, y - drop, z - back],
      thick,
    )
  }
}

// Angled horizontal slats across a rectangular opening (±halfX, yB..yTop) set
// just inside the face at `z`.
function addRectLouvers(
  p: number[],
  n: number[],
  uv: number[],
  halfX: number,
  yB: number,
  yTop: number,
  z: number,
  slats: number,
): void {
  if (slats <= 0) return
  const span = yTop - yB
  const drop = (span / (slats + 1)) * 0.55
  const back = Math.max(0.012, span * 0.18)
  const thick = Math.max(0.004, drop * 0.32)
  for (let k = 1; k <= slats; k++) {
    const y = yB + (span * k) / (slats + 1)
    addSlab(
      p,
      n,
      uv,
      [-halfX, y, z],
      [halfX, y, z],
      [halfX, y - drop, z - back],
      [-halfX, y - drop, z - back],
      thick,
    )
  }
}

// Extrude a planar quad (a→b→c→d) into a thin solid slab of `t` thickness
// along its normal — gives louver blades real depth so they don't read as
// paper-thin at a grazing angle. Each of the 6 faces is oriented outward from
// the slab centre, so winding is correct without hand-tracing.
function addSlab(
  p: number[],
  n: number[],
  uv: number[],
  a: number[],
  b: number[],
  c: number[],
  d: number[],
  t: number,
): void {
  let nx = (c[1]! - a[1]!) * (b[2]! - a[2]!) - (c[2]! - a[2]!) * (b[1]! - a[1]!)
  let ny = (c[2]! - a[2]!) * (b[0]! - a[0]!) - (c[0]! - a[0]!) * (b[2]! - a[2]!)
  let nz = (c[0]! - a[0]!) * (b[1]! - a[1]!) - (c[1]! - a[1]!) * (b[0]! - a[0]!)
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
  nx = (nx / len) * (t / 2)
  ny = (ny / len) * (t / 2)
  nz = (nz / len) * (t / 2)
  const up = (q: number[]): number[] => [q[0]! + nx, q[1]! + ny, q[2]! + nz]
  const dn = (q: number[]): number[] => [q[0]! - nx, q[1]! - ny, q[2]! - nz]
  const aT = up(a)
  const bT = up(b)
  const cT = up(c)
  const dT = up(d)
  const aB = dn(a)
  const bB = dn(b)
  const cB = dn(c)
  const dB = dn(d)
  let cx = 0
  let cy = 0
  let cz = 0
  for (const v of [aT, bT, cT, dT, aB, bB, cB, dB]) {
    cx += v[0]! / 8
    cy += v[1]! / 8
    cz += v[2]! / 8
  }
  const face = (q0: number[], q1: number[], q2: number[], q3: number[]) => {
    const mx = (q0[0]! + q1[0]! + q2[0]! + q3[0]!) / 4
    const my = (q0[1]! + q1[1]! + q2[1]! + q3[1]!) / 4
    const mz = (q0[2]! + q1[2]! + q2[2]! + q3[2]!) / 4
    pushQuad(p, n, uv, q0, q1, q2, q3, [mx - cx, my - cy, mz - cz])
  }
  face(aT, bT, cT, dT) // top
  face(aB, bB, cB, dB) // bottom
  face(aT, bT, bB, aB) // leading edge
  face(bT, cT, cB, bB) // right
  face(cT, dT, dB, cB) // trailing edge
  face(dT, aT, aB, dB) // left
}

// Half-ellipse ring (flat side down on `yB`): φ from 0 (+x) to π (−x).
function halfRing(
  a: number,
  b: number,
  yB: number,
  z: number,
  scale: number,
  steps: number,
): number[][] {
  const row: number[][] = []
  for (let j = 0; j <= steps; j++) {
    const phi = (Math.PI * j) / steps
    row.push([a * scale * Math.cos(phi), yB + b * scale * Math.sin(phi), z])
  }
  return row
}

// ─── Primitives ───────────────────────────────────────────────────────────

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

// Append a reversed-winding, negated-normal copy of every triangle already in
// the buffers, making the mesh render from both sides under a FrontSide
// material. `triCount` is snapshotted up front so we only mirror the originals.
function doubleSide(p: number[], n: number[], uv: number[]): void {
  const triCount = Math.floor(p.length / 9)
  for (let t = 0; t < triCount; t++) {
    const o = t * 9
    const u = t * 6
    // verts v0, v2, v1 (reverse the last two to flip the face).
    p.push(
      p[o]!,
      p[o + 1]!,
      p[o + 2]!,
      p[o + 6]!,
      p[o + 7]!,
      p[o + 8]!,
      p[o + 3]!,
      p[o + 4]!,
      p[o + 5]!,
    )
    n.push(
      -n[o]!,
      -n[o + 1]!,
      -n[o + 2]!,
      -n[o + 6]!,
      -n[o + 7]!,
      -n[o + 8]!,
      -n[o + 3]!,
      -n[o + 4]!,
      -n[o + 5]!,
    )
    uv.push(uv[u]!, uv[u + 1]!, uv[u + 4]!, uv[u + 5]!, uv[u + 2]!, uv[u + 3]!)
  }
}

// ─── Winding-safe primitives ─────────────────────────────────────────────

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
