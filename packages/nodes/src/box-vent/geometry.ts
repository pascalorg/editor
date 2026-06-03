import { type BoxVentNode, getActiveRoofHeight, type RoofType } from '@pascal-app/core'
import * as THREE from 'three'

/**
 * Pure builder for the box-vent mesh. Models a real attic box vent:
 *
 *   ┌──────────────────────┐        ← rounded dome cap (closed)
 *   │        ───           │
 *   │  ◜─────────────◝    │
 *  ─┘─────────────────────└─       ← flange flashing
 *
 * - **Body**: short rectangular walls + a sealed bottom.
 * - **Dome cap**: smooth half-ellipsoid that fully closes the top — no
 *   flat plateau (the old pyramid hood left one). Used for every style;
 *   `style` just tunes how much of the total height is body vs cap.
 * - **Skirt / flange**: the dome's base ring extends past the body by
 *   `hoodOverhang`, doubling as the mounting flashing tab.
 *
 * Louvered slats were removed — real box vents read smooth from typical
 * camera distances; the slat pile only made the ghost preview noisy and
 * the texture wrap unpredictable.
 *
 * Pure: no React, no scene access, no store mutation. Safe to call from
 * unit tests, the placement preview, and the move-tool ghost.
 */
export function buildBoxVentGeometry(node: BoxVentNode): THREE.BufferGeometry {
  if (node.style === 'box') return buildBoxShape(node)
  if (node.style === 'cap') return buildCapShape(node)
  return buildDomeStyleShape(node)
}

// ─── Box style ───────────────────────────────────────────────────────
// Two stacked rounded-corner boxes — a smaller riser at the base and a
// larger cover on top — reads as a residential attic-vent housing:
//
//          ┌───────────────────────────┐    ← top cover (w × d)
//          │                           │
//          │                           │
//          └────┐                 ┌────┘
//               │                 │           ← riser (inset by baseInset)
//               └─────────────────┘
//
// Both layers are extruded rounded rectangles so the vertical corners
// pick up the `cornerBevel`, giving a softer, more product-like silhou-
// ette than the old single hard-edged box.

const BOX_CORNER_SEGS = 4

function buildBoxShape(node: BoxVentNode): THREE.BufferGeometry {
  // Schema defaults only fire on parse; older nodes in the store may
  // not carry these fields. Fall back so the maths can never go NaN.
  const w = node.width
  const d = node.depth
  const h = node.height
  const baseInset = Math.max(0, Math.min(node.baseInset ?? 0.06, Math.min(w, d) / 2 - 0.005))
  const baseH = Math.max(0.005, Math.min(node.baseHeight ?? 0.04, h - 0.005))
  const baseW = Math.max(0.01, w - 2 * baseInset)
  const baseD = Math.max(0.01, d - 2 * baseInset)
  const cornerBevel = Math.max(
    0,
    Math.min(node.cornerBevel ?? 0.012, Math.min(baseW, baseD) / 2 - 0.001),
  )

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  // Lower (smaller) riser. Top is hidden under the cover but include
  // it anyway — overlap is invisible and the geometry stays simple.
  buildRoundedExtrusion(positions, normals, uvs, baseW, baseD, 0, baseH, cornerBevel)
  // Upper (larger) cover. Bottom partially shows where it overhangs the
  // riser, so it's always rendered.
  buildRoundedExtrusion(positions, normals, uvs, w, d, baseH, h, cornerBevel)

  return buildBufferGeometry(positions, normals, uvs)
}

// Extruded rounded rectangle: walls follow a rounded-rect profile,
// top + bottom caps are fan-triangulated from the centroid. Both caps
// are always included — overlap with adjacent geometry is invisible.
function buildRoundedExtrusion(
  positions: number[],
  normals: number[],
  uvs: number[],
  w: number,
  d: number,
  y0: number,
  y1: number,
  bevel: number,
): void {
  const profile = roundedRectProfile(w, d, bevel, BOX_CORNER_SEGS)
  const n = profile.length

  // Walls: each edge in the closed profile becomes an outward-facing quad.
  for (let i = 0; i < n; i++) {
    const a = profile[i]!
    const b = profile[(i + 1) % n]!
    const ex = b.x - a.x
    const ez = b.z - a.z
    const len = Math.sqrt(ex * ex + ez * ez)
    if (len < 1e-9) continue // degenerate edge (zero-bevel duplicate corner points)
    const nx = ez / len
    const nz = -ex / len
    pushQuad(
      positions,
      normals,
      uvs,
      [a.x, y0, a.z],
      [b.x, y0, b.z],
      [b.x, y1, b.z],
      [a.x, y1, a.z],
      [nx, 0, nz],
    )
  }

  // Top cap (+Y normal): wind triangles CW from above so the cross
  // product points up. See pushTri's comment for the orientation note.
  for (let i = 0; i < n; i++) {
    const a = profile[i]!
    const b = profile[(i + 1) % n]!
    pushTri(positions, normals, uvs, [0, y1, 0], [b.x, y1, b.z], [a.x, y1, a.z], [0, 1, 0])
  }

  // Bottom cap (-Y normal): wind CCW from above.
  for (let i = 0; i < n; i++) {
    const a = profile[i]!
    const b = profile[(i + 1) % n]!
    pushTri(positions, normals, uvs, [0, y0, 0], [a.x, y0, a.z], [b.x, y0, b.z], [0, -1, 0])
  }
}

// 2D rounded-rect profile in the XZ plane, traced CCW from above.
// `segsPerCorner` controls the corner smoothness — points are deduped
// per corner so adjacent corners share a clean tangent at the join.
function roundedRectProfile(
  w: number,
  d: number,
  bevel: number,
  segsPerCorner: number,
): Array<{ x: number; z: number }> {
  const hw = w / 2
  const hd = d / 2
  const r = Math.max(0, Math.min(bevel, hw, hd))
  // 4 corner centers, CCW from +X+Z (NE, NW, SW, SE).
  const corners: Array<{ cx: number; cz: number; startAngle: number }> = [
    { cx: hw - r, cz: hd - r, startAngle: 0 }, // NE
    { cx: -(hw - r), cz: hd - r, startAngle: Math.PI / 2 }, // NW
    { cx: -(hw - r), cz: -(hd - r), startAngle: Math.PI }, // SW
    { cx: hw - r, cz: -(hd - r), startAngle: Math.PI * 1.5 }, // SE
  ]
  const out: Array<{ x: number; z: number }> = []
  for (const c of corners) {
    // Skip the last sample of each corner — it duplicates the first
    // sample of the next corner.
    for (let k = 0; k < segsPerCorner; k++) {
      const t = k / segsPerCorner
      const angle = c.startAngle + t * (Math.PI / 2)
      out.push({ x: c.cx + r * Math.cos(angle), z: c.cz + r * Math.sin(angle) })
    }
  }
  return out
}

// ─── Cap style ───────────────────────────────────────────────────────
// Body walls topped by a chamfered truncated-pyramid cap. The cap base
// matches the body's footprint plus `hoodOverhang` (small flare), and
// narrows to a smaller flat top driven by `topTaper`. The chamfer angle
// is the geometric consequence of `capHeight` × `topTaper` — adjusting
// either one bends the slope steeper or shallower:
//
//                ┌─────┐                ← flat top (topTaper > 0)
//             ╱       ╲
//            ╱         ╲                ← chamfered cap (capHeight tall)
//          ┌──────────────┐             ← cap base = body + overhang
//          │              │
//          │     body     │             ← body (height − capHeight)
//          │              │
//          └──────────────┘

function buildCapShape(node: BoxVentNode): THREE.BufferGeometry {
  const w = node.width
  const d = node.depth
  const h = node.height
  // `??` guards legacy scene data — nodes saved before these fields
  // existed don't carry them, and the schema default only fires at
  // parse time (not on objects already in the store). Without these
  // fallbacks the arithmetic below produced NaN positions and broke
  // the bounding-sphere pass.
  const overhang = node.hoodOverhang ?? 0.04
  const topTaper = clamp01(node.topTaper ?? 0.4)
  // Reserve at least 5mm each for body + cap so neither collapses.
  const minSliver = 0.005
  const rawGap = Math.max(0, node.capGap ?? 0)
  const rawCapH = Math.max(minSliver, node.capHeight ?? 0.07)
  // Distribute the available `height` between body / gap / cap. If the
  // user dials the gap + cap past the total, shrink the gap first
  // (preserves the visible cap shape) and then the cap as a last resort.
  const maxBodyless = h - 2 * minSliver
  const capH = Math.min(rawCapH, Math.max(minSliver, maxBodyless))
  const capGap = Math.min(rawGap, Math.max(0, maxBodyless - capH))
  const bodyH = h - capH - capGap

  const hw = w / 2
  const hd = d / 2
  // Cap base extends past the body by `overhang` (flare). Top is the
  // body's footprint scaled by `1 - topTaper`.
  const bw = hw + overhang
  const bd = hd + overhang
  const tw = hw * (1 - topTaper)
  const td = hd * (1 - topTaper)

  // Cap floats `capGap` above the body. When the gap is zero the cap
  // sits flush on the body and the body's top is hidden by the cap, so
  // we skip the top face. When the gap is non-zero, close the body's
  // top so you can't see inside through the slot.
  const y0 = bodyH + capGap
  const y1 = h

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  // ── Body (4 walls + sealed bottom)
  pushQuad(
    positions,
    normals,
    uvs,
    [hw, 0, -hd],
    [hw, 0, hd],
    [hw, bodyH, hd],
    [hw, bodyH, -hd],
    [1, 0, 0],
  )
  pushQuad(
    positions,
    normals,
    uvs,
    [-hw, 0, hd],
    [-hw, 0, -hd],
    [-hw, bodyH, -hd],
    [-hw, bodyH, hd],
    [-1, 0, 0],
  )
  pushQuad(
    positions,
    normals,
    uvs,
    [hw, 0, hd],
    [-hw, 0, hd],
    [-hw, bodyH, hd],
    [hw, bodyH, hd],
    [0, 0, 1],
  )
  pushQuad(
    positions,
    normals,
    uvs,
    [-hw, 0, -hd],
    [hw, 0, -hd],
    [hw, bodyH, -hd],
    [-hw, bodyH, -hd],
    [0, 0, -1],
  )
  pushQuad(
    positions,
    normals,
    uvs,
    [-hw, 0, -hd],
    [-hw, 0, hd],
    [hw, 0, hd],
    [hw, 0, -hd],
    [0, -1, 0],
  )

  // ── Body top (only when there's a visible gap to look through)
  if (capGap > 0) {
    pushQuad(
      positions,
      normals,
      uvs,
      [-hw, bodyH, hd],
      [-hw, bodyH, -hd],
      [hw, bodyH, -hd],
      [hw, bodyH, hd],
      [0, 1, 0],
    )
  }

  // ── Flange underside (the bit of the cap base that overhangs the body)
  if (overhang > 0 || capGap > 0) {
    pushQuad(
      positions,
      normals,
      uvs,
      [-bw, y0, -bd],
      [-bw, y0, bd],
      [bw, y0, bd],
      [bw, y0, -bd],
      [0, -1, 0],
    )
  }

  // ── 4 chamfered cap faces (trapezoids: wider at base, narrow at top).
  // Normals point outward and upward (the slope direction). They're
  // computed from the slope vector to get accurate shading.
  const dx = bw - tw // horizontal slope run on the X-facing faces
  const dz = bd - td
  // +X face
  pushQuad(
    positions,
    normals,
    uvs,
    [bw, y0, -bd],
    [bw, y0, bd],
    [tw, y1, td],
    [tw, y1, -td],
    [dx, capH, 0],
  )
  // -X face
  pushQuad(
    positions,
    normals,
    uvs,
    [-bw, y0, bd],
    [-bw, y0, -bd],
    [-tw, y1, -td],
    [-tw, y1, td],
    [-dx, capH, 0],
  )
  // +Z face
  pushQuad(
    positions,
    normals,
    uvs,
    [bw, y0, bd],
    [-bw, y0, bd],
    [-tw, y1, td],
    [tw, y1, td],
    [0, capH, dz],
  )
  // -Z face
  pushQuad(
    positions,
    normals,
    uvs,
    [-bw, y0, -bd],
    [bw, y0, -bd],
    [tw, y1, -td],
    [-tw, y1, -td],
    [0, capH, -dz],
  )

  // ── Flat closed top plane (no hollow opening — even if topTaper is 0,
  // this collapses to the original body cross-section; if topTaper is 1
  // it degenerates to a point and the four triangles meet, still closed).
  pushQuad(
    positions,
    normals,
    uvs,
    [-tw, y1, td],
    [-tw, y1, -td],
    [tw, y1, -td],
    [tw, y1, td],
    [0, 1, 0],
  )

  return buildBufferGeometry(positions, normals, uvs)
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

// ─── Dome style (bullnose vent) ──────────────────────────────────────
// A stainless bullnose vent: a smooth half-ellipsoid dome that overhangs a
// short lifted collar — the collar is what gives the vent its visible depth
// standing off the roof — all seated on a wide round FLANGE plate that
// mounts to the roof. Every part is a surface of revolution; no square
// geometry anywhere.
//
//        .-""-.        ← dome (overhangs the collar lip)
//       /      \
//      |  | |   |       ← lifted collar (the depth above the flange)
//    __|        |__
//   |______________|    ← round flange plate on the roof
//
// `domeCurvature` shapes the cap; `hoodOverhang` sets how far the flange
// plate extends past the dome.

function buildDomeStyleShape(node: BoxVentNode): THREE.BufferGeometry {
  const rx = node.width / 2
  const rz = node.depth / 2
  const h = node.height
  const power = Math.max(0.3, Math.min(1.5, node.domeCurvature ?? 1.0))
  const lng = 24
  const lat = 8

  // Wide flange plate (extends past the dome by `hoodOverhang`) + thickness.
  const brim = Math.max(0, node.hoodOverhang ?? 0.04)
  const rxF = rx + brim
  const rzF = rz + brim
  const brimThk = Math.min(0.015, h * 0.18)
  // Collar: a touch narrower than the dome so the cap overhangs it, and tall
  // enough to read as real lift above the flange.
  const collarRx = rx * 0.9
  const collarRz = rz * 0.9
  const collarH = Math.max(0.012, Math.min(h * 0.4, h - brimThk - 0.02))
  const domeBaseY = brimThk + collarH
  const domeH = h - domeBaseY

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  const radial = (a: number[], _b: number[], c: number[]): number[] => {
    const mx = (a[0]! + c[0]!) / 2
    const mz = (a[2]! + c[2]!) / 2
    const l = Math.hypot(mx, mz) || 1
    return [mx / l, 0, mz / l]
  }
  const up = (): number[] => [0, 1, 0]
  const down = (): number[] => [0, -1, 0]

  const flangeBottom = ringAt(rxF, rzF, 0, lng)
  const flangeTop = ringAt(rxF, rzF, brimThk, lng)
  const collarFoot = ringAt(collarRx, collarRz, brimThk, lng)
  const collarTop = ringAt(collarRx, collarRz, domeBaseY, lng)
  const domeBase = ringAt(rx, rz, domeBaseY, lng)
  const center = ringAt(0, 0, 0, lng)

  // Flange: underside (down), outer rim (radial), top face (up).
  addBand(positions, normals, uvs, flangeBottom, center, lng, down)
  addBand(positions, normals, uvs, flangeBottom, flangeTop, lng, radial)
  addBand(positions, normals, uvs, flangeTop, collarFoot, lng, up)
  // Lifted collar wall (radial) + the overhanging dome-lip underside (down).
  addBand(positions, normals, uvs, collarFoot, collarTop, lng, radial)
  addBand(positions, normals, uvs, collarTop, domeBase, lng, down)

  // Dome cap, base ring → apex.
  const domeCenterY = domeBaseY
  const domeHint = (a: number[], _b: number[], c: number[]): number[] => {
    const x = (a[0]! + c[0]!) / 2
    const y = (a[1]! + c[1]!) / 2 - domeCenterY
    const z = (a[2]! + c[2]!) / 2
    const l = Math.hypot(x, y, z) || 1
    return [x / l, y / l, z / l]
  }
  let prev = domeBase
  for (let i = 1; i <= lat; i++) {
    const phi = (Math.PI / 2) * (i / lat)
    const rf = Math.cos(phi) ** power
    const y = domeBaseY + domeH * Math.sin(phi)
    const ring = ringAt(rx * rf, rz * rf, y, lng)
    addBand(positions, normals, uvs, prev, ring, lng, domeHint)
    prev = ring
  }

  return buildBufferGeometry(positions, normals, uvs)
}

// One ellipse ring of `lng` segments at height `y`. First and last points
// coincide (closing the loop) so callers iterate j < lng.
function ringAt(ax: number, az: number, y: number, lng: number): number[][] {
  const row: number[][] = []
  for (let j = 0; j <= lng; j++) {
    const t = (Math.PI * 2 * j) / lng
    row.push([ax * Math.cos(t), y, az * Math.sin(t)])
  }
  return row
}

// Connect two rings with a band of quads. `hintFn` returns the outward
// direction for each quad so pushQuadOriented can orient the face correctly.
function addBand(
  positions: number[],
  normals: number[],
  uvs: number[],
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
    pushQuadOriented(positions, normals, uvs, a, b, c, d, hintFn(a, b, c, d))
  }
}

// Winding-safe quad: triangulates (a,b,c,d) and orients both triangles so
// the shared flat normal points toward `hint`.
function pushQuadOriented(
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

// ─── Helpers ─────────────────────────────────────────────────────────

function buildBufferGeometry(
  positions: number[],
  normals: number[],
  uvs: number[],
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geo
}

function pushQuad(
  positions: number[],
  normals: number[],
  uvs: number[],
  a: number[],
  b: number[],
  c: number[],
  d: number[],
  n: number[],
) {
  const nLen = Math.sqrt(n[0]! * n[0]! + n[1]! * n[1]! + n[2]! * n[2]!) || 1
  const nx = n[0]! / nLen
  const ny = n[1]! / nLen
  const nz = n[2]! / nLen

  // Dimension-based planar UVs: U follows |b-a| (the quad's "right"
  // edge) and V follows |d-a| ("up"). Textures then tile at world
  // scale across every face — a 0.4m vent face uses 0.4 UV units, not
  // a fixed 0..1 — so a brick / metal / shingle preset reads at a
  // consistent density on the body, hood, and louvers.
  const abx = b[0]! - a[0]!
  const aby = b[1]! - a[1]!
  const abz = b[2]! - a[2]!
  const adx = d[0]! - a[0]!
  const ady = d[1]! - a[1]!
  const adz = d[2]! - a[2]!
  const u = Math.sqrt(abx * abx + aby * aby + abz * abz)
  const v = Math.sqrt(adx * adx + ady * ady + adz * adz)

  // Winding is (a, c, b) + (a, d, c) so the triangle face direction
  // matches the stored normal (see earlier note on the dark-shading
  // regression this fixed).
  positions.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, b[0]!, b[1]!, b[2]!)
  normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz)
  uvs.push(0, 0, u, v, u, 0)
  positions.push(a[0]!, a[1]!, a[2]!, d[0]!, d[1]!, d[2]!, c[0]!, c[1]!, c[2]!)
  normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz)
  uvs.push(0, 0, 0, v, u, v)
}

// pushTri: single-triangle counterpart to pushQuad. Caller orders (a, b, c)
// so that (b-a) × (c-a) points in the same direction as the stored
// normal `n` — same dark-shading-fix convention as pushQuad. UVs are
// dimension-based (length of the two sides from a).
function pushTri(
  positions: number[],
  normals: number[],
  uvs: number[],
  a: number[],
  b: number[],
  c: number[],
  n: number[],
) {
  const nLen = Math.sqrt(n[0]! * n[0]! + n[1]! * n[1]! + n[2]! * n[2]!) || 1
  const nx = n[0]! / nLen
  const ny = n[1]! / nLen
  const nz = n[2]! / nLen

  const abx = b[0]! - a[0]!
  const aby = b[1]! - a[1]!
  const abz = b[2]! - a[2]!
  const acx = c[0]! - a[0]!
  const acy = c[1]! - a[1]!
  const acz = c[2]! - a[2]!
  const u = Math.sqrt(abx * abx + aby * aby + abz * abz)
  const v = Math.sqrt(acx * acx + acy * acy + acz * acz)

  positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz)
  uvs.push(0, 0, u, 0, 0, v)
}

/**
 * Slope tilt for a box-vent at segment-local Z position. The vent's
 * X axis stays parallel to the segment's ridge; the +Z (down-slope)
 * side dips, the -Z (up-slope) side lifts. Flat segments return 0.
 *
 * Pure: lifted out so the renderer / move tool / preview share one
 * source of truth.
 */
export function computeBoxVentSlopeTilt(
  segment: { roofType: RoofType; pitch: number; width: number; depth: number } | undefined,
  localZ: number,
): number {
  if (!segment || segment.roofType === 'flat' || localZ === 0) return 0
  const rh = getActiveRoofHeight(segment)
  const slopeAngle = Math.atan2(rh, segment.depth / 2)
  return localZ > 0 ? slopeAngle : -slopeAngle
}
