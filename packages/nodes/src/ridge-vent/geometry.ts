import type { RidgeVentNode } from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const ARC_SEGMENTS = 8
const SHELL_THICKNESS = 0.25
const SHINGLED_PEAK_SEGS = 3
const SHINGLED_TAB_SIZE = 0.3

/**
 * Pure builder for the ridge vent mesh. Three styles share a common
 * cross-section approach: extrude a 2D profile (in the Y-Z plane)
 * along the segment's X axis (ridge direction), then add optional
 * end caps.
 *
 *  - `standard`: smooth curved shell with offset inner surface
 *  - `shingled`: angular slopes meeting at a rounded peak with tab ridges
 *  - `metal`: angular bent-metal cap with drip-edge lips and a center bead
 *
 * Pure: no React, no scene access, no store mutation.
 */
export function buildRidgeVentGeometry(node: RidgeVentNode): THREE.BufferGeometry {
  const halfLen = node.length / 2
  const halfW = node.width / 2
  const h = node.height

  const pieces: THREE.BufferGeometry[] = []

  if (node.style === 'metal') {
    pieces.push(buildMetalProfile(halfLen, halfW, h))
  } else if (node.style === 'shingled') {
    pieces.push(buildShingledProfile(halfLen, halfW, h))
  } else {
    pieces.push(buildCurvedCapProfile(halfLen, halfW, h))
  }

  if (node.endCaps) {
    const cap =
      node.style === 'metal'
        ? buildMetalEndCaps(halfLen, halfW, h)
        : node.style === 'shingled'
          ? buildShingledEndCaps(halfLen, halfW, h)
          : buildCurvedEndCaps(halfLen, halfW, h)
    if (cap) pieces.push(cap)
  }

  return pieces.length === 1 ? pieces[0]! : (mergeGeometries(pieces, false) ?? pieces[0]!)
}

// ─── Standard curved cap ─────────────────────────────────────────────

function buildCurvedCapProfile(
  halfLen: number,
  halfW: number,
  h: number,
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const t = h * SHELL_THICKNESS

  const outerPts: [number, number][] = []
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const frac = i / ARC_SEGMENTS
    const angle = Math.PI * frac
    const z = -halfW + frac * (2 * halfW)
    const y = h * Math.sin(angle)
    outerPts.push([z, y])
  }
  const innerPts = offsetProfileInward(outerPts, t)

  for (let i = 0; i < ARC_SEGMENTS; i++) {
    const [oz0, oy0] = outerPts[i]!
    const [oz1, oy1] = outerPts[i + 1]!
    const [iz0, iy0] = innerPts[i]!
    const [iz1, iy1] = innerPts[i + 1]!

    const dz = oz1 - oz0
    const dy = oy1 - oy0
    const fLen = Math.sqrt(dz * dz + dy * dy) || 1
    const fnz = -dy / fLen
    const fny = dz / fLen

    pushQuad(positions, normals, uvs,
      [-halfLen, oy0, oz0], [halfLen, oy0, oz0],
      [halfLen, oy1, oz1], [-halfLen, oy1, oz1],
      [0, fny, fnz])

    pushQuad(positions, normals, uvs,
      [-halfLen, iy1, iz1], [halfLen, iy1, iz1],
      [halfLen, iy0, iz0], [-halfLen, iy0, iz0],
      [0, -fny, -fnz])
  }

  // Eave bottoms
  for (const idx of [0, ARC_SEGMENTS]) {
    const [oz, oy] = outerPts[idx]!
    const [iz, iy] = innerPts[idx]!
    if (idx === 0) {
      pushQuad(positions, normals, uvs,
        [-halfLen, iy, iz], [halfLen, iy, iz],
        [halfLen, oy, oz], [-halfLen, oy, oz],
        [0, -1, 0])
    } else {
      pushQuad(positions, normals, uvs,
        [-halfLen, oy, oz], [halfLen, oy, oz],
        [halfLen, iy, iz], [-halfLen, iy, iz],
        [0, -1, 0])
    }
  }

  return buildBufferGeometry(positions, normals, uvs)
}

function buildCurvedEndCaps(
  halfLen: number,
  halfW: number,
  h: number,
): THREE.BufferGeometry | null {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const t = h * SHELL_THICKNESS

  const outerPts: [number, number][] = []
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const frac = i / ARC_SEGMENTS
    const angle = Math.PI * frac
    outerPts.push([-halfW + frac * (2 * halfW), h * Math.sin(angle)])
  }
  const innerPts = offsetProfileInward(outerPts, t)

  for (const sign of [-1, 1] as const) {
    const x = sign * halfLen
    for (let i = 0; i < ARC_SEGMENTS; i++) {
      const a: [number, number, number] = [x, outerPts[i]![1], outerPts[i]![0]]
      const b: [number, number, number] = [x, outerPts[i + 1]![1], outerPts[i + 1]![0]]
      const c: [number, number, number] = [x, innerPts[i + 1]![1], innerPts[i + 1]![0]]
      const d: [number, number, number] = [x, innerPts[i]![1], innerPts[i]![0]]
      if (sign > 0) pushQuad(positions, normals, uvs, a, b, c, d, [sign, 0, 0])
      else pushQuad(positions, normals, uvs, d, c, b, a, [sign, 0, 0])
    }
  }

  return positions.length === 0 ? null : buildBufferGeometry(positions, normals, uvs)
}

// ─── Shingled profile ───────────────────────────────────────────────

function shingledOuterPts(halfW: number, h: number): [number, number][] {
  const peakR = halfW * 0.1
  const slopeY = (h * (halfW - peakR)) / halfW
  const pts: [number, number][] = [[-halfW, 0]]
  for (let i = 0; i <= SHINGLED_PEAK_SEGS; i++) {
    const frac = i / SHINGLED_PEAK_SEGS
    const angle = Math.PI * (1 - frac)
    pts.push([peakR * Math.cos(angle), slopeY + (h - slopeY) * Math.sin(angle)])
  }
  pts.push([halfW, 0])
  return pts
}

function buildShingledProfile(
  halfLen: number,
  halfW: number,
  h: number,
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const t = h * SHELL_THICKNESS

  const outerPts = shingledOuterPts(halfW, h)
  const innerPts = offsetProfileInward(outerPts, t)

  for (let i = 0; i < outerPts.length - 1; i++) {
    const [oz0, oy0] = outerPts[i]!
    const [oz1, oy1] = outerPts[i + 1]!
    const [iz0, iy0] = innerPts[i]!
    const [iz1, iy1] = innerPts[i + 1]!

    const dz = oz1 - oz0
    const dy = oy1 - oy0
    const fLen = Math.sqrt(dz * dz + dy * dy) || 1
    const fnz = -dy / fLen
    const fny = dz / fLen

    pushQuad(positions, normals, uvs,
      [-halfLen, oy0, oz0], [halfLen, oy0, oz0],
      [halfLen, oy1, oz1], [-halfLen, oy1, oz1],
      [0, fny, fnz])

    pushQuad(positions, normals, uvs,
      [-halfLen, iy1, iz1], [halfLen, iy1, iz1],
      [halfLen, iy0, iz0], [-halfLen, iy0, iz0],
      [0, -fny, -fnz])
  }

  // Eave bottoms
  {
    const [oz, oy] = outerPts[0]!
    const [iz, iy] = innerPts[0]!
    pushQuad(positions, normals, uvs,
      [-halfLen, iy, iz], [halfLen, iy, iz],
      [halfLen, oy, oz], [-halfLen, oy, oz],
      [0, -1, 0])
  }
  {
    const last = outerPts.length - 1
    const [oz, oy] = outerPts[last]!
    const [iz, iy] = innerPts[last]!
    pushQuad(positions, normals, uvs,
      [-halfLen, oy, oz], [halfLen, oy, oz],
      [halfLen, iy, iz], [-halfLen, iy, iz],
      [0, -1, 0])
  }

  // Tab divider ridges along the length
  const totalLen = halfLen * 2
  const numTabs = Math.max(2, Math.round(totalLen / SHINGLED_TAB_SIZE))
  const tabLen = totalLen / numTabs
  const ridgeH = h * 0.06
  const ridgeD = 0.006

  for (let tab = 1; tab < numTabs; tab++) {
    const x = -halfLen + tab * tabLen
    for (let i = 0; i < outerPts.length - 1; i++) {
      const [oz0, oy0] = outerPts[i]!
      const [oz1, oy1] = outerPts[i + 1]!
      const dz = oz1 - oz0
      const dy = oy1 - oy0
      const fLen = Math.sqrt(dz * dz + dy * dy) || 1
      const fnz = -dy / fLen
      const fny = dz / fLen
      const r0y = oy0 + fny * ridgeH
      const r0z = oz0 + fnz * ridgeH
      const r1y = oy1 + fny * ridgeH
      const r1z = oz1 + fnz * ridgeH
      pushQuad(positions, normals, uvs,
        [x, r0y, r0z], [x, r1y, r1z], [x, oy1, oz1], [x, oy0, oz0],
        [1, 0, 0])
      pushQuad(positions, normals, uvs,
        [x, r0y, r0z], [x, r1y, r1z],
        [x - ridgeD, oy1, oz1], [x - ridgeD, oy0, oz0],
        [0, fny, fnz])
    }
  }

  return buildBufferGeometry(positions, normals, uvs)
}

function buildShingledEndCaps(
  halfLen: number,
  halfW: number,
  h: number,
): THREE.BufferGeometry | null {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const t = h * SHELL_THICKNESS

  const outerPts = shingledOuterPts(halfW, h)
  const innerPts = offsetProfileInward(outerPts, t)

  for (const sign of [-1, 1] as const) {
    const x = sign * halfLen
    for (let i = 0; i < outerPts.length - 1; i++) {
      const a: [number, number, number] = [x, outerPts[i]![1], outerPts[i]![0]]
      const b: [number, number, number] = [x, outerPts[i + 1]![1], outerPts[i + 1]![0]]
      const c: [number, number, number] = [x, innerPts[i + 1]![1], innerPts[i + 1]![0]]
      const d: [number, number, number] = [x, innerPts[i]![1], innerPts[i]![0]]
      if (sign > 0) pushQuad(positions, normals, uvs, a, b, c, d, [sign, 0, 0])
      else pushQuad(positions, normals, uvs, d, c, b, a, [sign, 0, 0])
    }
  }

  return positions.length === 0 ? null : buildBufferGeometry(positions, normals, uvs)
}

// ─── Metal profile ───────────────────────────────────────────────────

function metalProfile(halfW: number, h: number, t: number) {
  const lipH = h * 0.3
  const lipW = halfW * 0.15
  const beadW = halfW * 0.05
  const beadH = h * 0.12
  const outer: [number, number][] = [
    [-halfW, 0],
    [-halfW + lipW, lipH],
    [-beadW, h],
    [0, h + beadH],
    [beadW, h],
    [halfW - lipW, lipH],
    [halfW, 0],
  ]
  const inner: [number, number][] = [
    [-halfW, t],
    [-halfW + lipW, lipH + t],
    [-beadW, h - t],
    [0, h - t],
    [beadW, h - t],
    [halfW - lipW, lipH + t],
    [halfW, t],
  ]
  return { outer, inner }
}

function segNormal(z0: number, y0: number, z1: number, y1: number): number[] {
  const dz = z1 - z0
  const dy = y1 - y0
  const len = Math.sqrt(dz * dz + dy * dy) || 1
  return [0, dz / len, -dy / len]
}

function buildMetalProfile(
  halfLen: number,
  halfW: number,
  h: number,
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const t = h * SHELL_THICKNESS
  const { outer, inner } = metalProfile(halfW, h, t)

  for (let i = 0; i < outer.length - 1; i++) {
    const [oz0, oy0] = outer[i]!
    const [oz1, oy1] = outer[i + 1]!
    const [iz0, iy0] = inner[i]!
    const [iz1, iy1] = inner[i + 1]!

    const outerN = segNormal(oz0, oy0, oz1, oy1)
    const innerN = segNormal(iz0, iy0, iz1, iy1).map((v) => -v)

    pushQuad(positions, normals, uvs,
      [-halfLen, oy0, oz0], [halfLen, oy0, oz0],
      [halfLen, oy1, oz1], [-halfLen, oy1, oz1],
      outerN)

    pushQuad(positions, normals, uvs,
      [-halfLen, iy1, iz1], [halfLen, iy1, iz1],
      [halfLen, iy0, iz0], [-halfLen, iy0, iz0],
      innerN)
  }

  // Eave bottoms
  pushQuad(positions, normals, uvs,
    [-halfLen, inner[0]![1], inner[0]![0]], [halfLen, inner[0]![1], inner[0]![0]],
    [halfLen, outer[0]![1], outer[0]![0]], [-halfLen, outer[0]![1], outer[0]![0]],
    [0, -1, 0])
  const last = outer.length - 1
  pushQuad(positions, normals, uvs,
    [-halfLen, outer[last]![1], outer[last]![0]], [halfLen, outer[last]![1], outer[last]![0]],
    [halfLen, inner[last]![1], inner[last]![0]], [-halfLen, inner[last]![1], inner[last]![0]],
    [0, -1, 0])

  return buildBufferGeometry(positions, normals, uvs)
}

function buildMetalEndCaps(
  halfLen: number,
  halfW: number,
  h: number,
): THREE.BufferGeometry | null {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const t = h * SHELL_THICKNESS
  const { outer, inner } = metalProfile(halfW, h, t)

  for (const sign of [-1, 1] as const) {
    const x = sign * halfLen

    for (let i = 0; i < outer.length - 1; i++) {
      const a: [number, number, number] = [x, outer[i]![1], outer[i]![0]]
      const b: [number, number, number] = [x, outer[i + 1]![1], outer[i + 1]![0]]
      const c: [number, number, number] = [x, inner[i + 1]![1], inner[i + 1]![0]]
      const d: [number, number, number] = [x, inner[i]![1], inner[i]![0]]
      if (sign > 0) pushQuad(positions, normals, uvs, a, b, c, d, [sign, 0, 0])
      else pushQuad(positions, normals, uvs, d, c, b, a, [sign, 0, 0])
    }
  }

  return positions.length === 0 ? null : buildBufferGeometry(positions, normals, uvs)
}

// ─── Helpers ─────────────────────────────────────────────────────────

function offsetProfileInward(
  pts: [number, number][],
  t: number,
): [number, number][] {
  const result: [number, number][] = []
  for (let i = 0; i < pts.length; i++) {
    const [z, y] = pts[i]!
    let dz: number
    let dy: number
    if (i === 0) {
      dz = pts[1]![0] - z
      dy = pts[1]![1] - y
    } else if (i === pts.length - 1) {
      dz = z - pts[i - 1]![0]
      dy = y - pts[i - 1]![1]
    } else {
      dz = pts[i + 1]![0] - pts[i - 1]![0]
      dy = pts[i + 1]![1] - pts[i - 1]![1]
    }
    const len = Math.sqrt(dz * dz + dy * dy) || 1
    const nz = dy / len
    const ny = -dz / len
    result.push([z + nz * t, y + ny * t])
  }
  return result
}

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
  a: number[] | readonly number[],
  b: number[] | readonly number[],
  c: number[] | readonly number[],
  d: number[] | readonly number[],
  n: number[] | readonly number[],
) {
  positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  normals.push(n[0]!, n[1]!, n[2]!, n[0]!, n[1]!, n[2]!, n[0]!, n[1]!, n[2]!)
  uvs.push(0, 0, 1, 0, 1, 1)
  positions.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, d[0]!, d[1]!, d[2]!)
  normals.push(n[0]!, n[1]!, n[2]!, n[0]!, n[1]!, n[2]!, n[0]!, n[1]!, n[2]!)
  uvs.push(0, 0, 1, 1, 0, 1)
}
