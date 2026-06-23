import {
  getRoofSegmentVisibleTopBounds,
  type RidgeVentNode,
  type RoofSegmentNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { getRoofTopSurfaceY } from '../shared/roof-surface'

const ARC_SEGS = 16
const SHINGLED_TAB_SIZE = 0.3
const DEFAULT_RIDGE_VENT_LENGTH = 2
const DEFAULT_RIDGE_VENT_WIDTH = 0.3
const DEFAULT_RIDGE_VENT_HEIGHT = 0.1
type ProfilePoint = [z: number, capY: number]

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
export function buildRidgeVentGeometry(
  node: RidgeVentNode,
  segment?: RoofSegmentNode,
): THREE.BufferGeometry {
  const length = finitePositive(node.length, DEFAULT_RIDGE_VENT_LENGTH)
  const width = finitePositive(node.width, DEFAULT_RIDGE_VENT_WIDTH)
  const h = finitePositive(node.height, DEFAULT_RIDGE_VENT_HEIGHT)
  const halfLen = length / 2
  const halfW = width / 2
  // Band thickness. Generous enough to read as a solid cap; the eave faces
  // are `t` tall, which is the depth the user actually sees from the side.
  const t = Math.max(0.02, h * 0.4)

  const centerX = finiteNumber(node.position?.[0], 0)
  const centerZ = finiteNumber(node.position?.[2], 0)
  const rotationY = finiteNumber(node.rotation, 0)
  const sinR = Math.sin(rotationY)
  const cosR = Math.cos(rotationY)
  const clipRange = getVisibleLengthRange(node, segment, halfLen, cosR, sinR)
  if (!clipRange) return buildBufferGeometry([], [], [])
  const [startX, endX] = clipRange

  const surfaceYAt = (x: number, z: number) => {
    if (!segment) return 0
    return getRoofTopSurfaceY(centerX + x * cosR + z * sinR, centerZ - x * sinR + z * cosR, segment)
  }
  const ridgeY = surfaceYAt(0, 0)
  const seatYAt = (x: number, z: number) => (segment ? surfaceYAt(x, z) - ridgeY : 0)

  const top =
    node.style === 'metal'
      ? metalTop(halfW, h, t)
      : node.style === 'shingled'
        ? shingledTop(halfW, h, t)
        : standardTop(halfW, h, t)

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  buildBand(positions, normals, uvs, top, seatYAt, startX, endX, node.endCaps)

  if (node.style === 'shingled') {
    addShingledTabs(positions, normals, uvs, startX, endX, top, h, seatYAt)
  }

  return buildBufferGeometry(positions, normals, uvs)
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function finitePositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function getVisibleLengthRange(
  node: RidgeVentNode,
  segment: RoofSegmentNode | undefined,
  halfLen: number,
  cosR: number,
  sinR: number,
): [number, number] | null {
  if (!segment) return [-halfLen, halfLen]

  const bounds = getRoofSegmentVisibleTopBounds(segment)
  let start = -halfLen
  let end = halfLen
  const centerX = finiteNumber(node.position?.[0], 0)
  const centerZ = finiteNumber(node.position?.[2], 0)
  const dirX = cosR
  const dirZ = -sinR

  const clipAxis = (center: number, dir: number, min: number, max: number): boolean => {
    if (Math.abs(dir) < 1e-6) return center >= min && center <= max

    const a = (min - center) / dir
    const b = (max - center) / dir
    const low = Math.min(a, b)
    const high = Math.max(a, b)
    start = Math.max(start, low)
    end = Math.min(end, high)
    return end - start > 0.01
  }

  if (!clipAxis(centerX, dirX, bounds.minX, bounds.maxX)) return null
  if (!clipAxis(centerZ, dirZ, bounds.minZ, bounds.maxZ)) return null
  return end - start > 0.01 ? [start, end] : null
}

// ─── Top profiles (open polylines eave → peak → eave, in [z, y]) ─────────
// Eaves sit at y = t so that the underside (top − t) lands on y = 0 at the
// eaves, seating the cap on the roof while leaving a peaked void beneath.

// Smooth rounded arch.
function standardTop(halfW: number, h: number, t: number): ProfilePoint[] {
  const pts: ProfilePoint[] = []
  for (let i = 0; i <= ARC_SEGS; i++) {
    const frac = i / ARC_SEGS
    const z = -halfW + frac * 2 * halfW
    const y = t + (h - t) * Math.sin(frac * Math.PI)
    pts.push([z, y])
  }
  return pts
}

// Angular peak with a narrow flat ridge at the top.
function shingledTop(halfW: number, h: number, t: number): ProfilePoint[] {
  const peakHalf = halfW * 0.12
  return [
    [-halfW, t],
    [-peakHalf, h],
    [peakHalf, h],
    [halfW, t],
  ]
}

// Bent-metal cap: steep folds up to a wide flat standing seam.
function metalTop(halfW: number, h: number, t: number): ProfilePoint[] {
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
  top: ProfilePoint[],
  seatYAt: (x: number, z: number) => number,
  startX: number,
  endX: number,
  withCaps: boolean,
): void {
  const n = top.length
  const seatAt = (x: number, z: number): number => seatYAt(x, z)
  const topAt = (x: number, z: number, capY: number): number => seatAt(x, z) + capY

  // Top surface + underside, swept along the ridge length.
  for (let i = 0; i < n - 1; i++) {
    const [z0, capY0] = top[i]!
    const [z1, capY1] = top[i + 1]!
    pushQuad(
      positions,
      normals,
      uvs,
      [startX, topAt(startX, z0, capY0), z0],
      [endX, topAt(endX, z0, capY0), z0],
      [endX, topAt(endX, z1, capY1), z1],
      [startX, topAt(startX, z1, capY1), z1],
      [0, 1, 0],
    )
    pushQuad(
      positions,
      normals,
      uvs,
      [startX, seatAt(startX, z0), z0],
      [endX, seatAt(endX, z0), z0],
      [endX, seatAt(endX, z1), z1],
      [startX, seatAt(startX, z1), z1],
      [0, -1, 0],
    )
  }

  // Eave thickness faces (the visible depth along each long edge).
  for (const idx of [0, n - 1]) {
    const [z, capY] = top[idx]!
    const hint: [number, number, number] = [0, 0, z < 0 ? -1 : 1]
    pushQuad(
      positions,
      normals,
      uvs,
      [startX, seatAt(startX, z), z],
      [endX, seatAt(endX, z), z],
      [endX, topAt(endX, z, capY), z],
      [startX, topAt(startX, z, capY), z],
      hint,
    )
  }

  // End caps: the band's cross-section ring at each end.
  if (withCaps) {
    for (const [x, sign] of [
      [startX, -1],
      [endX, 1],
    ] as const) {
      const hint: [number, number, number] = [sign, 0, 0]
      for (let i = 0; i < n - 1; i++) {
        const [z0, capY0] = top[i]!
        const [z1, capY1] = top[i + 1]!
        pushQuad(
          positions,
          normals,
          uvs,
          [x, topAt(x, z0, capY0), z0],
          [x, topAt(x, z1, capY1), z1],
          [x, seatAt(x, z1), z1],
          [x, seatAt(x, z0), z0],
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
  startX: number,
  endX: number,
  top: ProfilePoint[],
  h: number,
  seatYAt: (x: number, z: number) => number,
): void {
  const totalLen = endX - startX
  const numTabs = Math.max(2, Math.round(totalLen / SHINGLED_TAB_SIZE))
  const tabLen = totalLen / numTabs
  const ridgeH = h * 0.06
  const ridgeD = Math.min(0.01, tabLen * 0.15)

  for (let tab = 1; tab < numTabs; tab++) {
    const x = startX + tab * tabLen
    for (let i = 0; i < top.length - 1; i++) {
      const [z0, capY0] = top[i]!
      const [z1, capY1] = top[i + 1]!
      const y0 = seatYAt(x, z0) + capY0
      const y1 = seatYAt(x, z1) + capY1
      const dz = z1 - z0
      const dy = y1 - y0
      const len = Math.sqrt(dz * dz + dy * dy) || 1
      const nz = -dy / len
      const ny = dz / len
      const r0y = y0 + ny * ridgeH
      const r0z = z0 + nz * ridgeH
      const r1y = y1 + ny * ridgeH
      const r1z = z1 + nz * ridgeH
      const backX = x - ridgeD
      const by0 = seatYAt(backX, z0) + capY0
      const by1 = seatYAt(backX, z1) + capY1
      const br0y = by0 + ny * ridgeH
      const br1y = by1 + ny * ridgeH
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
        [backX, br0y, r0z],
        [backX, br1y, r1z],
        [backX, by1, z1],
        [backX, by0, z0],
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
  if (positions.length === 0) {
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
    geo.computeBoundingSphere()
    return geo
  }
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
