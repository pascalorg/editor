import type { ChimneyNode, RoofSegmentNode } from '@pascal-app/core'
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
}

export function buildChimneyGeometry(
  node: ChimneyNode,
  segment: RoofSegmentNode,
): ChimneyGeometry {
  const peakY = segment.wallHeight + (segment.roofType === 'flat' ? 0 : segment.roofHeight)
  const topY = peakY + node.heightAboveRidge
  // Embed the body 0.2m below the eave so the bottom isn't visible
  // above the roof when the chimney sits over a low-slope segment.
  const baseY = Math.max(0, segment.wallHeight - 0.2)

  const body = buildBodyGeometry(node, baseY, topY)

  let cap: THREE.BufferGeometry | null = null
  let capTopY = topY
  if (node.cap && node.capShape !== 'none') {
    cap = buildCapGeometry(node, topY)
    capTopY = topY + node.capThickness
  }

  let flues: THREE.BufferGeometry | null = null
  if (node.flueCount > 0) {
    flues = buildFluesGeometry(node, capTopY)
  }

  let cricket: THREE.BufferGeometry | null = null
  if (node.cricketStyle !== 'none' && node.bodyShape !== 'round') {
    cricket = buildCricketGeometry(node, baseY)
  }

  return { body, cap, flues, cricket }
}

// ─── Body ────────────────────────────────────────────────────────────

function buildBodyGeometry(
  node: ChimneyNode,
  baseY: number,
  topY: number,
): THREE.BufferGeometry {
  const isRound = node.bodyShape === 'round'
  const w = node.width
  const d = isRound ? node.width : node.depth
  const r = w / 2

  const positions: number[] = []
  const uvs: number[] = []

  const style = node.shoulderStyle
  const ext = Math.max(0, node.shoulderExtent)
  const sh = Math.max(0.05, Math.min(node.shoulderHeight, topY - baseY - 0.05))

  if (style === 'none') {
    if (isRound) pushCylinderFaces(positions, uvs, baseY, topY, r, r)
    else pushSlabFaces(positions, uvs, baseY, topY, w / 2, d / 2, w / 2, d / 2)
  } else if (style === 'tapered') {
    if (isRound) {
      pushCylinderFaces(positions, uvs, baseY, baseY + sh, r + ext, r)
      pushCylinderFaces(positions, uvs, baseY + sh, topY, r, r)
    } else {
      pushSlabFaces(positions, uvs, baseY, baseY + sh, w / 2 + ext, d / 2 + ext, w / 2, d / 2)
      pushSlabFaces(positions, uvs, baseY + sh, topY, w / 2, d / 2, w / 2, d / 2)
    }
  } else {
    // corbeled — three steps
    const tiers = 3
    const tierH = sh / tiers
    for (let i = 0; i < tiers; i++) {
      const f = i / tiers
      const yBot = baseY + i * tierH
      const yTop = baseY + (i + 1) * tierH
      if (isRound) {
        const rr = r + ext * (1 - f)
        pushCylinderFaces(positions, uvs, yBot, yTop, rr, rr)
      } else {
        const hw = w / 2 + ext * (1 - f)
        const hd = d / 2 + ext * (1 - f)
        pushSlabFaces(positions, uvs, yBot, yTop, hw, hd, hw, hd)
      }
    }
    if (isRound) pushCylinderFaces(positions, uvs, baseY + sh, topY, r, r)
    else pushSlabFaces(positions, uvs, baseY + sh, topY, w / 2, d / 2, w / 2, d / 2)
  }

  const geo = buildBufferGeometry(positions, uvs)
  applyNodeTransform(geo, node)
  geo.computeVertexNormals()
  return geo
}

// ─── Cap ─────────────────────────────────────────────────────────────

function buildCapGeometry(node: ChimneyNode, topY: number): THREE.BufferGeometry {
  const overhang = Math.max(0, node.capOverhang)
  const t = node.capThickness
  const isRound = node.bodyShape === 'round'
  const halfW = node.width / 2 + overhang
  const halfD = (isRound ? node.width : node.depth) / 2 + overhang
  const halfWInner = node.width / 2
  const halfDInner = (isRound ? node.width : node.depth) / 2

  const positions: number[] = []
  const uvs: number[] = []
  const y0 = topY
  const y1 = topY + t

  switch (node.capShape) {
    case 'flat':
      if (isRound) pushCylinderFaces(positions, uvs, y0, y1, halfW, halfW)
      else pushSlabFaces(positions, uvs, y0, y1, halfW, halfD, halfW, halfD)
      break
    case 'stepped': {
      const tiers = 3
      const tT = t / tiers
      for (let i = 0; i < tiers; i++) {
        const f = i / tiers
        const yBot = y0 + i * tT
        const yTop = y0 + (i + 1) * tT
        if (isRound) {
          const rr = halfW + (halfWInner - halfW) * f
          pushCylinderFaces(positions, uvs, yBot, yTop, rr, rr)
        } else {
          const hw = halfW + (halfWInner - halfW) * f
          const hd = halfD + (halfDInner - halfD) * f
          pushSlabFaces(positions, uvs, yBot, yTop, hw, hd, hw, hd)
        }
      }
      break
    }
    default:
      // 'sloped' — taper from overhang base to chimney footprint at top
      if (isRound) pushCylinderFaces(positions, uvs, y0, y1, halfW, halfWInner)
      else pushSlabFaces(positions, uvs, y0, y1, halfW, halfD, halfWInner, halfDInner)
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

function buildFluesGeometry(node: ChimneyNode, capTopY: number): THREE.BufferGeometry | null {
  const count = Math.max(0, Math.min(4, node.flueCount))
  if (count === 0) return null

  const d = Math.max(0.02, node.flueDiameter)
  const h = Math.max(0.02, node.flueHeight)
  const xs = flueXPositions(count, node.width, d, node.flueSpacing)
  const parts: THREE.BufferGeometry[] = []

  for (const x of xs) {
    const flueGeo: THREE.BufferGeometry =
      node.flueShape === 'square'
        ? new THREE.BoxGeometry(d, h, d)
        : new THREE.CylinderGeometry(d / 2, d / 2, h, 24, 1, false)
    flueGeo.translate(x, capTopY + h / 2, 0)
    parts.push(flueGeo)
  }

  const merged = parts.length === 1 ? parts[0]! : (mergeGeometries(parts, false) ?? parts[0]!)
  if (merged !== parts[0]) for (const p of parts) p.dispose()

  applyNodeTransform(merged, node)
  merged.computeVertexNormals()
  return merged
}

// ─── Cricket ─────────────────────────────────────────────────────────
// Water-shedding wedge on the up-slope side of the chimney.

function buildCricketGeometry(
  node: ChimneyNode,
  baseY: number,
): THREE.BufferGeometry {
  const w = node.width
  const d = node.depth
  const cL = Math.max(0.1, node.cricketLength)
  const cH = Math.max(0.05, node.cricketHeight)
  const slopeSign = node.cricketSide === 'back' ? -1 : 1
  const sZ = slopeSign * (d / 2)
  const sZFar = sZ + slopeSign * cL
  const peakY = baseY + cH

  const positions: number[] = []
  const uvs: number[] = []

  const v0: [number, number, number] = [-w / 2, baseY, sZ]
  const v1: [number, number, number] = [w / 2, baseY, sZ]
  const v2: [number, number, number] = [w / 2, baseY, sZFar]
  const v3: [number, number, number] = [-w / 2, baseY, sZFar]
  const v4: [number, number, number] = [-w / 2, peakY, sZ]
  const v5: [number, number, number] = [w / 2, peakY, sZ]

  const pushTri = (a: number[], b: number[], c: number[]) => {
    if (slopeSign > 0) positions.push(...a, ...b, ...c)
    else positions.push(...a, ...c, ...b)
    uvs.push(0, 0, 0, 0, 0, 0)
  }
  pushTri(v0, v1, v2)
  pushTri(v0, v2, v3)
  pushTri(v3, v2, v5)
  pushTri(v3, v5, v4)
  pushTri(v0, v4, v5)
  pushTri(v0, v5, v1)
  pushTri(v0, v3, v4)
  pushTri(v1, v5, v2)

  const geo = buildBufferGeometry(positions, uvs)
  applyNodeTransform(geo, node)
  geo.computeVertexNormals()
  return geo
}

// ─── Helpers ─────────────────────────────────────────────────────────

function applyNodeTransform(geo: THREE.BufferGeometry, node: ChimneyNode) {
  if (Math.abs(node.rotation) > 1e-4) geo.rotateY(node.rotation)
  geo.translate(node.position[0] ?? 0, 0, node.position[2] ?? 0)
}

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
) {
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
  pushQuad(bBL, bTL, bTR, bBR,
    [-halfWB, -halfDB], [-halfWB, halfDB], [halfWB, halfDB], [halfWB, -halfDB])
  // Top
  pushQuad(tBL, tBR, tTR, tTL,
    [-halfWT, -halfDT], [halfWT, -halfDT], [halfWT, halfDT], [-halfWT, halfDT])
  // Sides
  pushQuad(bBL, bBR, tBR, tBL, [-halfWB, 0], [halfWB, 0], [halfWT, t], [-halfWT, t])
  pushQuad(bBR, bTR, tTR, tBR, [-halfDB, 0], [halfDB, 0], [halfDT, t], [-halfDT, t])
  pushQuad(bTR, bTL, tTL, tTR, [halfWB, 0], [-halfWB, 0], [-halfWT, t], [halfWT, t])
  pushQuad(bTL, bBL, tBL, tTL, [halfDB, 0], [-halfDB, 0], [-halfDT, t], [halfDT, t])
}

function pushCylinderFaces(
  positions: number[],
  uvs: number[],
  y0: number,
  y1: number,
  rB: number,
  rT: number,
  segments = 24,
) {
  const t = y1 - y0
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const c0 = Math.cos(a0)
    const s0 = Math.sin(a0)
    const c1 = Math.cos(a1)
    const s1 = Math.sin(a1)
    const bL: [number, number, number] = [rB * c0, y0, rB * s0]
    const bR: [number, number, number] = [rB * c1, y0, rB * s1]
    const tL: [number, number, number] = [rT * c0, y1, rT * s0]
    const tR: [number, number, number] = [rT * c1, y1, rT * s1]
    positions.push(...bL, ...tR, ...bR)
    positions.push(...bL, ...tL, ...tR)
    const u0 = i / segments
    const u1 = (i + 1) / segments
    uvs.push(u0, 0, u1, t, u1, 0)
    uvs.push(u0, 0, u0, t, u1, t)
  }
  // Bottom + top caps
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const p0B: [number, number, number] = [rB * Math.cos(a0), y0, rB * Math.sin(a0)]
    const p1B: [number, number, number] = [rB * Math.cos(a1), y0, rB * Math.sin(a1)]
    positions.push(0, y0, 0, ...p0B, ...p1B)
    uvs.push(0, 0, 0, 0, 0, 0)
    const p0T: [number, number, number] = [rT * Math.cos(a0), y1, rT * Math.sin(a0)]
    const p1T: [number, number, number] = [rT * Math.cos(a1), y1, rT * Math.sin(a1)]
    positions.push(0, y1, 0, ...p1T, ...p0T)
    uvs.push(0, 0, 0, 0, 0, 0)
  }
}
