import { type BoxVentNode, getActiveRoofHeight, type RoofType } from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

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
  // `dome` will get its own dedicated builder in Step 3. For now it
  // keeps the unified dome+skirt shape so the visual doesn't regress.
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

// ─── Dome style (current implementation) ─────────────────────────────
// Body + dome cap with flange skirt. Drives the `dome` style until
// Step 3 swaps it for a dedicated builder.

function buildDomeStyleShape(node: BoxVentNode): THREE.BufferGeometry {
  const w = node.width
  const d = node.depth
  const h = node.height
  // Dome has no flange — the cap rolls down flush to the body footprint.
  // `hoodOverhang` is hidden from the panel for this style; we ignore any
  // stored value so legacy nodes still render flush.
  const overhang = 0

  const bodyH = h * 0.32
  const hoodH = h - bodyH

  return (
    mergeGeometries(
      [buildBody(w, d, bodyH), buildDomeHood(w, d, overhang, bodyH, hoodH, 'dome')],
      false,
    ) ?? buildBody(w, d, bodyH)
  )
}

// ─── Body ────────────────────────────────────────────────────────────

function buildBody(w: number, d: number, bodyH: number): THREE.BufferGeometry {
  const hw = w / 2
  const hd = d / 2
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  // +X side
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
  // -X side
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
  // +Z side
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
  // -Z side
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
  // Bottom (closes the body so it reads as solid from below)
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

  return buildBufferGeometry(positions, normals, uvs)
}

// ─── Dome hood ───────────────────────────────────────────────────────
// Closed rounded cap (half-ellipsoid sampled on a lat × lng grid) plus
// a flat skirt that extends past the body by `overhang` — that skirt is
// what reads as the flashing flange in the reference photo. The cap is
// fully closed at the apex (single pole vertex), so there's no empty
// plateau like the old pyramid hood had.
//
// `style` shifts the dome shape subtly:
//  - 'standard'    → moderate dome, gentle roll-off near the apex
//  - 'low-profile' → very shallow dome (mostly a curved pillow)
//  - 'dome'        → near-hemisphere with sharper apex curvature

function buildDomeHood(
  w: number,
  d: number,
  overhang: number,
  bodyH: number,
  hoodH: number,
  style: BoxVentNode['style'],
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  const bw = w / 2 + overhang
  const bd = d / 2 + overhang
  const y0 = bodyH

  // Skirt underside
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

  // Sample a low-resolution dome on a lat × lng grid. The radial decay
  // is `cos(phi) ^ radialPower` — `radialPower < 1` keeps the dome wide
  // longer near the top (soft pillow silhouette, like the reference
  // photo). `dome` uses a true ellipsoid; `cap` defaults to a softer
  // pillow until Step 2 swaps it for the pyramid hood.
  const radialPower = style === 'dome' ? 1.0 : 0.65
  const lat = 6
  const lng = 14
  const points: THREE.Vector3[][] = []
  for (let i = 0; i <= lat; i++) {
    const row: THREE.Vector3[] = []
    const phi = (Math.PI / 2) * (i / lat)
    const r = Math.cos(phi) ** radialPower
    const y = y0 + hoodH * Math.sin(phi)
    for (let j = 0; j <= lng; j++) {
      const theta = Math.PI * 2 * (j / lng)
      const x = bw * r * Math.cos(theta)
      const z = bd * r * Math.sin(theta)
      row.push(new THREE.Vector3(x, y, z))
    }
    points.push(row)
  }

  const ab = new THREE.Vector3()
  const ad = new THREE.Vector3()
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lng; j++) {
      const a = points[i]![j]!
      const b = points[i]![j + 1]!
      const c = points[i + 1]![j + 1]!
      const d2 = points[i + 1]![j]!
      ab.subVectors(b, a)
      ad.subVectors(d2, a)
      // Outward dome normal: `ad × ab` matches pushQuad's `(a,c,b)+(a,d,c)`
      // winding (see note in `pushQuad`). Swapping the cross operands here
      // keeps the dome lit from the outside, not from inside.
      const n = new THREE.Vector3().crossVectors(ad, ab).normalize()
      pushQuad(
        positions,
        normals,
        uvs,
        [a.x, a.y, a.z],
        [b.x, b.y, b.z],
        [c.x, c.y, c.z],
        [d2.x, d2.y, d2.z],
        [n.x, n.y, n.z],
      )
    }
  }

  return buildBufferGeometry(positions, normals, uvs)
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
