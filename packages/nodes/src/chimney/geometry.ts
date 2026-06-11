import { type ChimneyNode, getActiveRoofHeight, type RoofSegmentNode } from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Pure chimney geometry builder. Returns body, cap, flues, and cricket
 * as separate BufferGeometries so each can carry its own material
 * (body/top split mirrors the schema's `material` vs `topMaterial`).
 *
 * **Option C scope** (see commit message): no CSG. The chimney body
 * intersects the roof at the deck line; the cap is solid (no flue
 * holes carved); the body has no hollow shaft cavity; flues are solid
 * cylinders/boxes protruding from the cap. Decorative bands and inset
 * panels are no-op on this builder until roof-segment migrates to
 * Stage B and a `roofCutout` capability lets the parent segment own
 * its own boolean operations.
 *
 * Pure: no React, no scene access, no store mutation. Takes the
 * segment as a second argument so the body height can be derived from
 * the segment's pitch — analogous to `door`'s `ctx.parent` access.
 */
export type ChimneyGeometry = {
  body: THREE.BufferGeometry
  cap: THREE.BufferGeometry | null
  flues: THREE.BufferGeometry | null
  cricket: THREE.BufferGeometry | null
  bands: THREE.BufferGeometry | null
}

// Small air gap between the body top and the cap bottom — without it
// the cap reads as glued onto the body; this slot catches a shadow
// line and sells the cap as a separate stone/metal piece.
const CAP_REVEAL = 0.003

/**
 * Smooth-shaded indexed cylinder. Used for every round body / cap /
 * band section. `THREE.CylinderGeometry` gives us:
 *  - shared side vertices across adjacent radial segments → smooth
 *    cylindrical shading (the previous unindexed pusher made every
 *    24-segment chimney visibly faceted),
 *  - separate cap-rim vertices → crisp top/bottom edges,
 *  - radial UV projection on the caps (vs. the previous (0,0) smear).
 */
function buildSmoothCylinder(
  yBot: number,
  yTop: number,
  rBot: number,
  rTop: number,
  segments = 24,
): THREE.BufferGeometry {
  const h = Math.max(1e-4, yTop - yBot)
  const cy = (yTop + yBot) / 2
  // CylinderGeometry params: radiusTop, radiusBottom, height, radialSegments,
  // heightSegments, openEnded.
  const geo = new THREE.CylinderGeometry(rTop, rBot, h, segments, 1, false)
  geo.translate(0, cy, 0)
  return geo
}

function mergeAndDispose(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 1) return parts[0]!
  const merged = mergeGeometries(parts, false)
  if (!merged) return parts[0]!
  for (const p of parts) p.dispose()
  return merged
}

export function buildChimneyGeometry(node: ChimneyNode, segment: RoofSegmentNode): ChimneyGeometry {
  const peakY = segment.wallHeight + getActiveRoofHeight(segment)
  const topY = peakY + node.heightAboveRidge
  // Embed the body 0.2m below the eave so the bottom isn't visible
  // above the roof when the chimney sits over a low-slope segment.
  const baseY = Math.max(0, segment.wallHeight - 0.2)

  const body = buildBodyGeometry(node, baseY, topY)

  let cap: THREE.BufferGeometry | null = null
  let capTopY = topY
  if (node.cap && node.capShape !== 'none') {
    // Inset the cap by `CAP_REVEAL` above the body top so a shadow
    // line separates them.
    const capBaseY = topY + CAP_REVEAL
    cap = buildCapGeometry(node, capBaseY)
    capTopY = capBaseY + node.capThickness
  }

  let flues: THREE.BufferGeometry | null = null
  if (node.flueCount > 0) {
    flues = buildFluesGeometry(node, capTopY)
  }

  let cricket: THREE.BufferGeometry | null = null
  if (node.cricketStyle !== 'none' && node.bodyShape !== 'round') {
    cricket = buildCricketGeometry(node, baseY)
  }

  let bands: THREE.BufferGeometry | null = null
  if (node.bandStyle !== 'none') {
    bands = buildBandsGeometry(node, baseY, topY)
  }

  return { body, cap, flues, cricket, bands }
}

// ─── Body ────────────────────────────────────────────────────────────

function buildBodyGeometry(node: ChimneyNode, baseY: number, topY: number): THREE.BufferGeometry {
  const isRound = node.bodyShape === 'round'
  const w = node.width
  const d = isRound ? node.width : node.depth
  const r = w / 2

  const style = node.shoulderStyle
  const ext = Math.max(0, node.shoulderExtent)
  const sh = Math.max(0.05, Math.min(node.shoulderHeight, topY - baseY - 0.05))

  if (isRound) {
    // Round body — assemble from smooth-shaded indexed cylinder pieces.
    // Each shoulder tier is its own cylinder so corbeled steps stay
    // crisp; the merge below preserves indices.
    const parts: THREE.BufferGeometry[] = []
    if (style === 'none') {
      parts.push(buildSmoothCylinder(baseY, topY, r, r))
    } else if (style === 'tapered') {
      parts.push(buildSmoothCylinder(baseY, baseY + sh, r + ext, r))
      parts.push(buildSmoothCylinder(baseY + sh, topY, r, r))
    } else {
      // corbeled — three stepped tiers, then the straight shaft above.
      const tiers = 3
      const tierH = sh / tiers
      for (let i = 0; i < tiers; i++) {
        const f = i / tiers
        const yBot = baseY + i * tierH
        const yTop = baseY + (i + 1) * tierH
        const rr = r + ext * (1 - f)
        parts.push(buildSmoothCylinder(yBot, yTop, rr, rr))
      }
      parts.push(buildSmoothCylinder(baseY + sh, topY, r, r))
    }
    const merged = mergeAndDispose(parts)
    return merged
  }

  // Square body — keep the unindexed face emitter; pass cornerBevel
  // so each slab section's vertical corners are chamfered into 45°
  // faces. The chamfer catches a highlight on every edge and reads as
  // a masonry chimney instead of a plastic box.
  const positions: number[] = []
  const uvs: number[] = []
  const bevel = Math.max(0, node.cornerBevel ?? 0)

  if (style === 'none') {
    pushSlabFaces(positions, uvs, baseY, topY, w / 2, d / 2, w / 2, d / 2, bevel)
  } else if (style === 'tapered') {
    pushSlabFaces(positions, uvs, baseY, baseY + sh, w / 2 + ext, d / 2 + ext, w / 2, d / 2, bevel)
    pushSlabFaces(positions, uvs, baseY + sh, topY, w / 2, d / 2, w / 2, d / 2, bevel)
  } else {
    const tiers = 3
    const tierH = sh / tiers
    for (let i = 0; i < tiers; i++) {
      const f = i / tiers
      const yBot = baseY + i * tierH
      const yTop = baseY + (i + 1) * tierH
      const hw = w / 2 + ext * (1 - f)
      const hd = d / 2 + ext * (1 - f)
      pushSlabFaces(positions, uvs, yBot, yTop, hw, hd, hw, hd, bevel)
    }
    pushSlabFaces(positions, uvs, baseY + sh, topY, w / 2, d / 2, w / 2, d / 2, bevel)
  }

  const geo = buildBufferGeometry(positions, uvs)
  applyNodeTransform(geo, node)
  geo.computeVertexNormals()
  return geo
}

// ─── Cap ─────────────────────────────────────────────────────────────

function buildCapGeometry(node: ChimneyNode, capBaseY: number): THREE.BufferGeometry {
  const overhang = Math.max(0, node.capOverhang)
  const t = node.capThickness
  const isRound = node.bodyShape === 'round'
  const halfW = node.width / 2 + overhang
  const halfD = (isRound ? node.width : node.depth) / 2 + overhang
  const halfWInner = node.width / 2
  const halfDInner = (isRound ? node.width : node.depth) / 2

  const y0 = capBaseY
  const y1 = capBaseY + t

  if (isRound) {
    const parts: THREE.BufferGeometry[] = []
    switch (node.capShape) {
      case 'flat':
        parts.push(buildSmoothCylinder(y0, y1, halfW, halfW))
        break
      case 'stepped': {
        const tiers = 3
        const tT = t / tiers
        for (let i = 0; i < tiers; i++) {
          const f = i / tiers
          const yBot = y0 + i * tT
          const yTop = y0 + (i + 1) * tT
          const rr = halfW + (halfWInner - halfW) * f
          parts.push(buildSmoothCylinder(yBot, yTop, rr, rr))
        }
        break
      }
      default:
        // 'sloped' — taper from overhang base to chimney footprint at top
        parts.push(buildSmoothCylinder(y0, y1, halfW, halfWInner))
        break
    }
    const merged = mergeAndDispose(parts)
    return merged
  }

  // Square cap — unindexed slabs, optional corner chamfer.
  const positions: number[] = []
  const uvs: number[] = []
  const bevel = Math.max(0, node.cornerBevel ?? 0)
  switch (node.capShape) {
    case 'flat':
      pushSlabFaces(positions, uvs, y0, y1, halfW, halfD, halfW, halfD, bevel)
      break
    case 'stepped': {
      const tiers = 3
      const tT = t / tiers
      for (let i = 0; i < tiers; i++) {
        const f = i / tiers
        const yBot = y0 + i * tT
        const yTop = y0 + (i + 1) * tT
        const hw = halfW + (halfWInner - halfW) * f
        const hd = halfD + (halfDInner - halfD) * f
        pushSlabFaces(positions, uvs, yBot, yTop, hw, hd, hw, hd, bevel)
      }
      break
    }
    default:
      pushSlabFaces(positions, uvs, y0, y1, halfW, halfD, halfWInner, halfDInner, bevel)
      break
  }

  const geo = buildBufferGeometry(positions, uvs)
  applyNodeTransform(geo, node)
  geo.computeVertexNormals()
  return geo
}

// ─── Flues ───────────────────────────────────────────────────────────

export function flueXPositions(
  count: number,
  chimneyWidth: number,
  flueDiameter: number,
  spacing = 1,
): number[] {
  if (count <= 0) return []
  if (count === 1) return [0]
  const fullAvailable = Math.max(0, chimneyWidth - flueDiameter)
  const available = fullAvailable * Math.max(0, Math.min(1, spacing))
  const xs: number[] = []
  for (let i = 0; i < count; i++) {
    xs.push(-available / 2 + (i * available) / (count - 1))
  }
  return xs
}

// Flue-pot proportions. The previous renderer drew each flue as a
// single straight cylinder/box — visually a "drainpipe", not a chimney
// pot. Real terracotta pots have a tall shaft topped by a short
// overhanging rim; this two-tier silhouette is the cheapest geometry
// that reads as a pot. Total height still equals `flueHeight`, so the
// bore cutter in `holes.ts` covers the whole envelope unchanged.
const FLUE_RIM_HEIGHT_RATIO = 0.12 // 12 % of total height, capped below
const FLUE_RIM_HEIGHT_MAX = 0.04 // 4 cm — bigger than this looks chunky
const FLUE_RIM_OVERHANG_RATIO = 0.12 // 12 % of flue diameter, radially

function buildFluesGeometry(node: ChimneyNode, capTopY: number): THREE.BufferGeometry | null {
  const count = Math.max(0, Math.min(4, node.flueCount))
  if (count === 0) return null

  const d = Math.max(0.02, node.flueDiameter)
  const h = Math.max(0.02, node.flueHeight)
  const xs = flueXPositions(count, node.width, d, node.flueSpacing)
  const parts: THREE.BufferGeometry[] = []

  const rimHeight = Math.min(h * FLUE_RIM_HEIGHT_RATIO, FLUE_RIM_HEIGHT_MAX)
  const shaftHeight = h - rimHeight
  const rimOverhang = d * FLUE_RIM_OVERHANG_RATIO

  for (const x of xs) {
    const yBot = capTopY
    const yShaftTop = capTopY + shaftHeight

    if (node.flueShape === 'square') {
      const shaft = new THREE.BoxGeometry(d, shaftHeight, d)
      shaft.translate(x, yBot + shaftHeight / 2, 0)
      parts.push(shaft)
      const rimSide = d + 2 * rimOverhang
      const rim = new THREE.BoxGeometry(rimSide, rimHeight, rimSide)
      rim.translate(x, yShaftTop + rimHeight / 2, 0)
      parts.push(rim)
    } else {
      // Round flues: indexed CylinderGeometry — smooth shafts, crisp
      // rim edges, radial cap UVs (same #1/#2 fixes already applied to
      // the body / cap / bands).
      const shaft = buildSmoothCylinder(yBot, yShaftTop, d / 2, d / 2)
      shaft.translate(x, 0, 0)
      parts.push(shaft)
      const rimR = d / 2 + rimOverhang
      const rim = buildSmoothCylinder(yShaftTop, yShaftTop + rimHeight, rimR, rimR)
      rim.translate(x, 0, 0)
      parts.push(rim)
    }
  }

  if (parts.length === 0) return null
  const merged = mergeAndDispose(parts)
  applyNodeTransform(merged, node)
  return merged
}

// ─── Cricket ─────────────────────────────────────────────────────────
// Water-shedding wedge on the up-slope side of the chimney.

function buildCricketGeometry(node: ChimneyNode, baseY: number): THREE.BufferGeometry {
  const w = node.width
  const d = node.depth
  const cL = Math.max(0.1, node.cricketLength)
  const cH = Math.max(0.05, node.cricketHeight)
  const slopeSign = node.cricketSide === 'back' ? -1 : 1
  const sZ = slopeSign * (d / 2)
  const sZFar = sZ + slopeSign * cL
  const peakY = baseY + cH
  const slopeLen = Math.hypot(cL, cH)

  const positions: number[] = []
  const uvs: number[] = []

  // Vertex layout (back = against the chimney face):
  //   v0/v1  back-bottom (left/right)   v4/v5  back-top (left/right)
  //   v3/v2  front-bottom (left/right)
  const v0: [number, number, number] = [-w / 2, baseY, sZ]
  const v1: [number, number, number] = [w / 2, baseY, sZ]
  const v2: [number, number, number] = [w / 2, baseY, sZFar]
  const v3: [number, number, number] = [-w / 2, baseY, sZFar]
  const v4: [number, number, number] = [-w / 2, peakY, sZ]
  const v5: [number, number, number] = [w / 2, peakY, sZ]

  // Planar UVs per face — each face mapped to its own 2D extent so the
  // texture tiles correctly (u along width, v along the in-face axis).
  const u0_: [number, number] = [0, 0]
  const u1_: [number, number] = [w, 0]
  const uvBottom: Record<'v0' | 'v1' | 'v2' | 'v3', [number, number]> = {
    v0: u0_,
    v1: u1_,
    v2: [w, cL],
    v3: [0, cL],
  }
  const uvSlope: Record<'v3' | 'v2' | 'v5' | 'v4', [number, number]> = {
    v3: [0, 0],
    v2: [w, 0],
    v5: [w, slopeLen],
    v4: [0, slopeLen],
  }
  const uvBack: Record<'v0' | 'v1' | 'v5' | 'v4', [number, number]> = {
    v0: [0, 0],
    v1: [w, 0],
    v5: [w, cH],
    v4: [0, cH],
  }
  const uvLeft: Record<'v0' | 'v3' | 'v4', [number, number]> = {
    v0: [0, 0],
    v3: [cL, 0],
    v4: [0, cH],
  }
  const uvRight: Record<'v1' | 'v5' | 'v2', [number, number]> = {
    v1: [0, 0],
    v5: [0, cH],
    v2: [cL, 0],
  }

  const pushTri = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    ua: [number, number],
    ub: [number, number],
    uc: [number, number],
  ) => {
    if (slopeSign > 0) {
      positions.push(...a, ...b, ...c)
      uvs.push(...ua, ...ub, ...uc)
    } else {
      positions.push(...a, ...c, ...b)
      uvs.push(...ua, ...uc, ...ub)
    }
  }

  // Bottom (quad split into 2 tris)
  pushTri(v0, v1, v2, uvBottom.v0, uvBottom.v1, uvBottom.v2)
  pushTri(v0, v2, v3, uvBottom.v0, uvBottom.v2, uvBottom.v3)
  // Sloped top (v3 v2 v5 v4)
  pushTri(v3, v2, v5, uvSlope.v3, uvSlope.v2, uvSlope.v5)
  pushTri(v3, v5, v4, uvSlope.v3, uvSlope.v5, uvSlope.v4)
  // Back face against the chimney (v0 v1 v5 v4)
  pushTri(v0, v4, v5, uvBack.v0, uvBack.v4, uvBack.v5)
  pushTri(v0, v5, v1, uvBack.v0, uvBack.v5, uvBack.v1)
  // Left side triangle
  pushTri(v0, v3, v4, uvLeft.v0, uvLeft.v3, uvLeft.v4)
  // Right side triangle
  pushTri(v1, v5, v2, uvRight.v1, uvRight.v5, uvRight.v2)

  const geo = buildBufferGeometry(positions, uvs)
  applyNodeTransform(geo, node)
  geo.computeVertexNormals()
  return geo
}

// ─── Bands ───────────────────────────────────────────────────────────
// Decorative horizontal stripes around the chimney (soldier-course
// brick / stone band). Single or double; each band protrudes outward
// by `bandExtent` per side.

function buildBandsGeometry(
  node: ChimneyNode,
  baseY: number,
  topY: number,
): THREE.BufferGeometry | null {
  const isRound = node.bodyShape === 'round'
  const w = node.width
  const d = isRound ? node.width : node.depth
  const r = w / 2
  const bandExt = Math.max(0, node.bandExtent)
  const bandH = Math.max(0.02, node.bandHeight)
  const bandOffset = Math.max(0, node.bandOffset)
  const count = node.bandStyle === 'double' ? 2 : 1
  const gap = bandH * 0.6

  if (isRound) {
    const parts: THREE.BufferGeometry[] = []
    for (let i = 0; i < count; i++) {
      const bandTop = topY - bandOffset - i * (bandH + gap)
      const bandBot = bandTop - bandH
      if (bandBot <= baseY + 0.01) break
      parts.push(buildSmoothCylinder(bandBot, bandTop, r + bandExt, r + bandExt))
    }
    if (parts.length === 0) return null
    const merged = mergeAndDispose(parts)
    return merged
  }

  const positions: number[] = []
  const uvs: number[] = []
  const bevel = Math.max(0, node.cornerBevel ?? 0)
  for (let i = 0; i < count; i++) {
    const bandTop = topY - bandOffset - i * (bandH + gap)
    const bandBot = bandTop - bandH
    if (bandBot <= baseY + 0.01) break
    pushSlabFaces(
      positions,
      uvs,
      bandBot,
      bandTop,
      w / 2 + bandExt,
      d / 2 + bandExt,
      w / 2 + bandExt,
      d / 2 + bandExt,
      bevel,
    )
  }

  if (positions.length === 0) return null

  const geo = buildBufferGeometry(positions, uvs)
  applyNodeTransform(geo, node)
  geo.computeVertexNormals()
  return geo
}

// ─── Helpers ─────────────────────────────────────────────────────────

// Each builder returns geometry in chimney-local frame (chimney center
// at X/Z origin, Y absolute in the host segment's frame). The renderer
// applies `node.position` / `node.rotation` via a nested registered
// group, which lets `NodeArrowHandles` read a chimney-local mesh frame
// when placing the resize / rotation arrows. Kept as a no-op shim so
// the existing call sites don't need to be touched if a future refactor
// re-introduces per-builder baking.
function applyNodeTransform(_geo: THREE.BufferGeometry, _node: ChimneyNode) {}

function buildBufferGeometry(positions: number[], uvs: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geo
}

function pushSlabFaces(
  positions: number[],
  uvs: number[],
  y0: number,
  y1: number,
  halfWB: number,
  halfDB: number,
  halfWT: number,
  halfDT: number,
  bevel = 0,
) {
  // Clamp bevel so it never eats more than the slab can spare on
  // either ring (a wider bottom plus a narrower top, e.g. an inverted
  // taper, has different limits per ring).
  const cB = Math.max(0, Math.min(bevel, halfWB - 0.001, halfDB - 0.001))
  const cT = Math.max(0, Math.min(bevel, halfWT - 0.001, halfDT - 0.001))
  if (cB > 0.001 || cT > 0.001) {
    pushOctagonalSlabFaces(positions, uvs, y0, y1, halfWB, halfDB, halfWT, halfDT, cB, cT)
    return
  }

  const t = y1 - y0
  const bBL: [number, number, number] = [-halfWB, y0, -halfDB]
  const bBR: [number, number, number] = [halfWB, y0, -halfDB]
  const bTR: [number, number, number] = [halfWB, y0, halfDB]
  const bTL: [number, number, number] = [-halfWB, y0, halfDB]
  const tBL: [number, number, number] = [-halfWT, y1, -halfDT]
  const tBR: [number, number, number] = [halfWT, y1, -halfDT]
  const tTR: [number, number, number] = [halfWT, y1, halfDT]
  const tTL: [number, number, number] = [-halfWT, y1, halfDT]

  const pushQuad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    ua: [number, number],
    ub: [number, number],
    uc: [number, number],
    ud: [number, number],
  ) => {
    positions.push(...a, ...c, ...b, ...a, ...d, ...c)
    uvs.push(...ua, ...uc, ...ub, ...ua, ...ud, ...uc)
  }

  // Bottom
  pushQuad(
    bBL,
    bTL,
    bTR,
    bBR,
    [-halfWB, -halfDB],
    [-halfWB, halfDB],
    [halfWB, halfDB],
    [halfWB, -halfDB],
  )
  // Top
  pushQuad(
    tBL,
    tBR,
    tTR,
    tTL,
    [-halfWT, -halfDT],
    [halfWT, -halfDT],
    [halfWT, halfDT],
    [-halfWT, halfDT],
  )
  // Sides
  pushQuad(bBL, bBR, tBR, tBL, [-halfWB, 0], [halfWB, 0], [halfWT, t], [-halfWT, t])
  pushQuad(bBR, bTR, tTR, tBR, [-halfDB, 0], [halfDB, 0], [halfDT, t], [-halfDT, t])
  pushQuad(bTR, bTL, tTL, tTR, [halfWB, 0], [-halfWB, 0], [-halfWT, t], [halfWT, t])
  pushQuad(bTL, bBL, tBL, tTL, [halfDB, 0], [-halfDB, 0], [-halfDT, t], [halfDT, t])
}

/**
 * Octagonal-footprint variant of `pushSlabFaces`. Each corner of the
 * usual 4-corner slab is replaced by a 45° chamfer, giving an
 * 8-vertex ring at each y-level. Eight side faces (four axis-aligned
 * + four chamfer) plus two fan-triangulated octagonal caps. UVs use
 * the same physical-meter convention as the unchamfered path so
 * textures (brick, stone) tile at a consistent rate either way.
 */
function pushOctagonalSlabFaces(
  positions: number[],
  uvs: number[],
  y0: number,
  y1: number,
  halfWB: number,
  halfDB: number,
  halfWT: number,
  halfDT: number,
  cB: number,
  cT: number,
) {
  // Eight ring vertices per y-level, traced so consecutive entries
  // share an outward-facing wall edge. Order (looking down +Y):
  //   p0 (+x, -z+c)  p1 (+x, +z-c)  p2 (+x-c, +z)  p3 (-x+c, +z)
  //   p4 (-x, +z-c)  p5 (-x, -z+c)  p6 (-x+c, -z)  p7 (+x-c, -z)
  const ring = (hw: number, hd: number, c: number, y: number) =>
    [
      [hw, y, -hd + c],
      [hw, y, hd - c],
      [hw - c, y, hd],
      [-hw + c, y, hd],
      [-hw, y, hd - c],
      [-hw, y, -hd + c],
      [-hw + c, y, -hd],
      [hw - c, y, -hd],
    ] as Array<[number, number, number]>

  const bot = ring(halfWB, halfDB, cB, y0)
  const top = ring(halfWT, halfDT, cT, y1)
  const t = y1 - y0

  // Eight walls. UVs: u = signed perimeter offset (in meters) from
  // the start of each wall, v = height.
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8
    const bA = bot[i]!
    const bB = bot[j]!
    const tA = top[i]!
    const tB = top[j]!
    const wallLen = Math.hypot(bB[0] - bA[0], bB[2] - bA[2])
    // Two CCW-from-outside triangles per quad: (bA, bB, tB) + (bA, tB, tA).
    positions.push(...bA, ...bB, ...tB, ...bA, ...tB, ...tA)
    uvs.push(0, 0, wallLen, 0, wallLen, t, 0, 0, wallLen, t, 0, t)
  }

  // Top cap: fan from centre. CCW from above → +Y normal.
  const cTop: [number, number, number] = [0, y1, 0]
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8
    const a = top[i]!
    const b = top[j]!
    positions.push(...cTop, ...b, ...a)
    uvs.push(0, 0, b[0], b[2], a[0], a[2])
  }

  // Bottom cap: reverse winding → -Y normal.
  const cBot: [number, number, number] = [0, y0, 0]
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8
    const a = bot[i]!
    const b = bot[j]!
    positions.push(...cBot, ...a, ...b)
    uvs.push(0, 0, a[0], a[2], b[0], b[2])
  }
}
