import type { RidgeVentNode } from '@pascal-app/core'
import * as THREE from 'three'

const ARC_SEGS = 16
const SHINGLED_TAB_SIZE = 0.3

/**
 * Pure builder for the ridge vent mesh. Each style is a peaked **band** of
 * constant thickness `t` that drapes over the ridge like a real ridge cap:
 * a shaped top surface, a parallel underside offset down by `t`, visible
 * eave thickness faces along both edges, and end caps.
 *
 * This is the middle ground between the two earlier extremes — the original
 * was a paper-thin shell (no perceptible thickness), then a flat-bottomed
 * solid (read as a closed box). The band keeps the V / arched cap silhouette
 * and the open underside (so it sits astride the ridge) while showing real
 * thickness at the eaves and ends.
 *
 *  - `standard`: smooth rounded arch
 *  - `shingled`: angular peak with raised shingle-course ridges across the top
 *  - `metal`: bent-metal cap with a wide flat seam and drip lips
 *
 * `endCaps` closes both ends. Pure: no React, no scene access, no mutation.
 */
export function buildRidgeVentGeometry(node: RidgeVentNode): THREE.BufferGeometry {
  const halfLen = node.length / 2
  const halfW = node.width / 2
  const h = node.height
  // Band thickness. Generous enough to read as a solid cap; the eave faces
  // are `t` tall, which is the depth the user actually sees from the side.
  const t = Math.max(0.02, h * 0.4)

  const top =
    node.style === 'metal'
      ? metalTop(halfW, h, t)
      : node.style === 'shingled'
        ? shingledTop(halfW, h, t)
        : standardTop(halfW, h, t)

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  buildBand(positions, normals, uvs, top, t, halfLen, node.endCaps)

  if (node.style === 'shingled') {
    addShingledTabs(positions, normals, uvs, halfLen, top, h)
  }

  return buildBufferGeometry(positions, normals, uvs)
}

// ─── Top profiles (open polylines eave → peak → eave, in [z, y]) ─────────
// Eaves sit at y = t so that the underside (top − t) lands on y = 0 at the
// eaves, seating the cap on the roof while leaving a peaked void beneath.

// Smooth rounded arch.
function standardTop(halfW: number, h: number, t: number): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i <= ARC_SEGS; i++) {
    const frac = i / ARC_SEGS
    const z = -halfW + frac * 2 * halfW
    const y = t + (h - t) * Math.sin(frac * Math.PI)
    pts.push([z, y])
  }
  return pts
}

// Angular peak with a narrow flat ridge at the top.
function shingledTop(halfW: number, h: number, t: number): [number, number][] {
  const peakHalf = halfW * 0.12
  return [
    [-halfW, t],
    [-peakHalf, h],
    [peakHalf, h],
    [halfW, t],
  ]
}

// Bent-metal cap: steep folds up to a wide flat standing seam.
function metalTop(halfW: number, h: number, t: number): [number, number][] {
  const seamHalf = halfW * 0.5
  const shoulderY = t + (h - t) * 0.5
  return [
    [-halfW, t],
    [-halfW * 0.82, shoulderY],
    [-seamHalf, h],
    [seamHalf, h],
    [halfW * 0.82, shoulderY],
    [halfW, t],
  ]
}

// ─── Band assembly ───────────────────────────────────────────────────────

function buildBand(
  positions: number[],
  normals: number[],
  uvs: number[],
  top: [number, number][],
  t: number,
  halfLen: number,
  withCaps: boolean,
): void {
  const n = top.length
  // Underside: the same profile dropped straight down by `t` (eaves → y 0).
  const inner: [number, number][] = top.map(([z, y]) => [z, y - t])

  // Top surface + underside, swept along the ridge length.
  for (let i = 0; i < n - 1; i++) {
    const [z0, y0] = top[i]!
    const [z1, y1] = top[i + 1]!
    pushQuad(
      positions,
      normals,
      uvs,
      [-halfLen, y0, z0],
      [halfLen, y0, z0],
      [halfLen, y1, z1],
      [-halfLen, y1, z1],
      [0, 1, 0],
    )
    const [iz0, iy0] = inner[i]!
    const [iz1, iy1] = inner[i + 1]!
    pushQuad(
      positions,
      normals,
      uvs,
      [-halfLen, iy0, iz0],
      [halfLen, iy0, iz0],
      [halfLen, iy1, iz1],
      [-halfLen, iy1, iz1],
      [0, -1, 0],
    )
  }

  // Eave thickness faces (the visible depth along each long edge).
  for (const idx of [0, n - 1]) {
    const [z, yTop] = top[idx]!
    const [, yInner] = inner[idx]!
    const hint: [number, number, number] = [0, 0, z < 0 ? -1 : 1]
    pushQuad(
      positions,
      normals,
      uvs,
      [-halfLen, yInner, z],
      [halfLen, yInner, z],
      [halfLen, yTop, z],
      [-halfLen, yTop, z],
      hint,
    )
  }

  // End caps: the band's cross-section ring at each end.
  if (withCaps) {
    for (const sign of [-1, 1] as const) {
      const x = sign * halfLen
      const hint: [number, number, number] = [sign, 0, 0]
      for (let i = 0; i < n - 1; i++) {
        const [z0, y0] = top[i]!
        const [z1, y1] = top[i + 1]!
        const [iz0, iy0] = inner[i]!
        const [iz1, iy1] = inner[i + 1]!
        pushQuad(
          positions,
          normals,
          uvs,
          [x, y0, z0],
          [x, y1, z1],
          [x, iy1, iz1],
          [x, iy0, iz0],
          hint,
        )
      }
    }
  }
}

// ─── Shingled course ridges ──────────────────────────────────────────────
// Thin raised lines running across the cap at intervals, suggesting
// overlapping shingle courses. Sit on the top profile edges.

function addShingledTabs(
  positions: number[],
  normals: number[],
  uvs: number[],
  halfLen: number,
  top: [number, number][],
  h: number,
): void {
  const totalLen = halfLen * 2
  const numTabs = Math.max(2, Math.round(totalLen / SHINGLED_TAB_SIZE))
  const tabLen = totalLen / numTabs
  const ridgeH = h * 0.06
  const ridgeD = Math.min(0.01, tabLen * 0.15)

  for (let tab = 1; tab < numTabs; tab++) {
    const x = -halfLen + tab * tabLen
    for (let i = 0; i < top.length - 1; i++) {
      const [z0, y0] = top[i]!
      const [z1, y1] = top[i + 1]!
      const dz = z1 - z0
      const dy = y1 - y0
      const len = Math.sqrt(dz * dz + dy * dy) || 1
      const nz = -dy / len
      const ny = dz / len
      const r0y = y0 + ny * ridgeH
      const r0z = z0 + nz * ridgeH
      const r1y = y1 + ny * ridgeH
      const r1z = z1 + nz * ridgeH
      pushQuad(
        positions,
        normals,
        uvs,
        [x, r0y, r0z],
        [x, r1y, r1z],
        [x, y1, z1],
        [x, y0, z0],
        [1, 0, 0],
      )
      pushQuad(
        positions,
        normals,
        uvs,
        [x - ridgeD, r0y, r0z],
        [x - ridgeD, r1y, r1z],
        [x - ridgeD, y1, z1],
        [x - ridgeD, y0, z0],
        [-1, 0, 0],
      )
    }
  }
}

// ─── Geometry plumbing ───────────────────────────────────────────────────

function buildBufferGeometry(
  positions: number[],
  normals: number[],
  uvs: number[],
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.computeBoundingSphere()
  return geo
}

// Winding-safe quad: triangulates (a,b,c,d) and orients both triangles so
// the shared flat normal points toward `hint`. UVs are dimension-based so
// painted presets tile at world scale across the ridge length and the cap.
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
