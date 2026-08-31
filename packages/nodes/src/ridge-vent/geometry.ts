import {
  getDutchRoofMetrics,
  getRidgeVentLinesForSegment,
  normalizeRoofSegmentTrim,
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
type RidgeVentGeometryVertex = {
  x: number
  y: number
  z: number
  nx: number
  ny: number
  nz: number
  u: number
  v: number
}
type SegmentTrimClipPlane = {
  signedDistance: (segmentX: number, segmentZ: number) => number
}

type RidgeVentSupportLine = {
  startX: number
  endX: number
  name: string
  taperAtStart: boolean
  taperAtEnd: boolean
}
type RidgeVentEndTaper = {
  taperAtStart: boolean
  taperAtEnd: boolean
  taperLength: number
  tipHalfWidth: number
}

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
  const dutchTopRidgeSupport = getDutchTopRidgeSupport(segment, centerX, centerZ, rotationY)
  const surfaceYAt = (x: number, z: number) => {
    if (!segment) return 0
    let sampleX = centerX + x * cosR + z * sinR
    let sampleZ = centerZ - x * sinR + z * cosR
    if (dutchTopRidgeSupport) {
      if (dutchTopRidgeSupport.axis === 'x') {
        sampleX = clamp(
          sampleX,
          -dutchTopRidgeSupport.innerHalfSpan,
          dutchTopRidgeSupport.innerHalfSpan,
        )
      } else {
        sampleZ = clamp(
          sampleZ,
          -dutchTopRidgeSupport.innerHalfSpan,
          dutchTopRidgeSupport.innerHalfSpan,
        )
      }
    }
    return getRoofTopSurfaceY(sampleX, sampleZ, segment)
  }
  const ridgeY = surfaceYAt(0, 0)
  const seatYAt = (x: number, z: number) => (segment ? surfaceYAt(x, z) - ridgeY : 0)

  const top =
    node.style === 'metal'
      ? metalTop(halfW, h, t)
      : node.style === 'shingled'
        ? shingledTop(halfW, h, t)
        : standardTop(halfW, h, t)
  const supportLine = segment ? getSupportLineForVent(segment, node) : null
  const endTaper = getRidgeVentEndTaper(supportLine, width, h)

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  buildBand(positions, normals, uvs, top, seatYAt, -halfLen, halfLen, node.endCaps, endTaper)

  if (node.style === 'shingled') {
    addShingledTabs(positions, normals, uvs, -halfLen, halfLen, top, h, seatYAt, endTaper)
  }

  const geometry = buildBufferGeometry(positions, normals, uvs)
  if (!segment) return geometry

  const clipped = clipRidgeVentGeometryToSegmentTrim(geometry, node, segment)
  if (clipped !== geometry) geometry.dispose()
  return clipped
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function finitePositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getRidgeVentEndTaper(
  supportLine: RidgeVentSupportLine | null,
  width: number,
  height: number,
): RidgeVentEndTaper | null {
  if (
    !supportLine ||
    (supportLine.name !== 'Hip Ridge Vent' && supportLine.name !== 'Slope Ridge Vent')
  ) {
    return null
  }

  const lineLength = supportLine.endX - supportLine.startX
  const taperLength = Math.min(
    Math.max(0.07, width * 0.45, height * 0.9),
    Math.max(0, lineLength / 2 - 0.02),
  )
  if (!(taperLength > 0.001)) return null

  return {
    taperAtStart: supportLine.taperAtStart,
    taperAtEnd: supportLine.taperAtEnd,
    taperLength,
    tipHalfWidth: Math.min(width * 0.34, Math.max(0.04, width * 0.26)),
  }
}

function getDutchTopRidgeSupport(
  segment: RoofSegmentNode | undefined,
  centerX: number,
  centerZ: number,
  rotationY: number,
): { axis: 'x' | 'z'; innerHalfSpan: number } | null {
  if (segment?.roofType !== 'dutch') return null

  const metrics = getDutchRoofMetrics(segment)
  const onWidthAxisTopRidge =
    metrics.axis === 'x' && Math.abs(centerZ) <= 1e-4 && Math.abs(Math.sin(rotationY)) <= 1e-4
  const onDepthAxisTopRidge =
    metrics.axis === 'z' && Math.abs(centerX) <= 1e-4 && Math.abs(Math.cos(rotationY)) <= 1e-4

  if (onWidthAxisTopRidge) {
    return { axis: 'x', innerHalfSpan: metrics.waistHalfX }
  }
  if (onDepthAxisTopRidge) {
    return { axis: 'z', innerHalfSpan: metrics.waistHalfZ }
  }
  return null
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
  endTaper: RidgeVentEndTaper | null = null,
): void {
  const n = top.length
  const halfWidth = getProfileHalfWidth(top)
  const stations = getRidgeVentSweepStations(startX, endX, endTaper)
  const scaledZAt = (x: number, z: number): number =>
    z * getProfileScaleAtX(x, startX, endX, halfWidth, endTaper)
  const seatAt = (x: number, z: number): number => seatYAt(x, scaledZAt(x, z))
  const topAt = (x: number, z: number, capY: number): number => seatAt(x, z) + capY

  // Top surface + underside, swept along the ridge length.
  for (let station = 0; station < stations.length - 1; station += 1) {
    const x0 = stations[station]!
    const x1 = stations[station + 1]!
    for (let i = 0; i < n - 1; i++) {
      const [z0, capY0] = top[i]!
      const [z1, capY1] = top[i + 1]!
      const x0z0 = scaledZAt(x0, z0)
      const x1z0 = scaledZAt(x1, z0)
      const x1z1 = scaledZAt(x1, z1)
      const x0z1 = scaledZAt(x0, z1)
      pushQuad(
        positions,
        normals,
        uvs,
        [x0, topAt(x0, z0, capY0), x0z0],
        [x1, topAt(x1, z0, capY0), x1z0],
        [x1, topAt(x1, z1, capY1), x1z1],
        [x0, topAt(x0, z1, capY1), x0z1],
        [0, 1, 0],
      )
      pushQuad(
        positions,
        normals,
        uvs,
        [x0, seatAt(x0, z0), x0z0],
        [x1, seatAt(x1, z0), x1z0],
        [x1, seatAt(x1, z1), x1z1],
        [x0, seatAt(x0, z1), x0z1],
        [0, -1, 0],
      )
    }
  }

  // Eave thickness faces (the visible depth along each long edge).
  for (let station = 0; station < stations.length - 1; station += 1) {
    const x0 = stations[station]!
    const x1 = stations[station + 1]!
    for (const idx of [0, n - 1]) {
      const [z, capY] = top[idx]!
      const x0z = scaledZAt(x0, z)
      const x1z = scaledZAt(x1, z)
      const hint: [number, number, number] = [0, 0, z < 0 ? -1 : 1]
      pushQuad(
        positions,
        normals,
        uvs,
        [x0, seatAt(x0, z), x0z],
        [x1, seatAt(x1, z), x1z],
        [x1, topAt(x1, z, capY), x1z],
        [x0, topAt(x0, z, capY), x0z],
        hint,
      )
    }
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
        const scaledZ0 = scaledZAt(x, z0)
        const scaledZ1 = scaledZAt(x, z1)
        pushQuad(
          positions,
          normals,
          uvs,
          [x, topAt(x, z0, capY0), scaledZ0],
          [x, topAt(x, z1, capY1), scaledZ1],
          [x, seatAt(x, z1), scaledZ1],
          [x, seatAt(x, z0), scaledZ0],
          hint,
        )
      }
    }
  }
}

function getProfileHalfWidth(top: ProfilePoint[]): number {
  return top.reduce((halfWidth, [z]) => Math.max(halfWidth, Math.abs(z)), 0)
}

function getRidgeVentSweepStations(
  startX: number,
  endX: number,
  endTaper: RidgeVentEndTaper | null,
): number[] {
  const stations = [startX, endX]
  if (endTaper?.taperAtStart) stations.push(startX + endTaper.taperLength)
  if (endTaper?.taperAtEnd) stations.push(endX - endTaper.taperLength)
  return stations
    .filter((x) => x >= startX && x <= endX)
    .sort((a, b) => a - b)
    .filter((x, index, sorted) => index === 0 || Math.abs(x - sorted[index - 1]!) > 1e-5)
}

function getProfileScaleAtX(
  x: number,
  startX: number,
  endX: number,
  halfWidth: number,
  endTaper: RidgeVentEndTaper | null,
): number {
  if (!endTaper || !(halfWidth > 0.0001)) return 1

  const tipScale = clamp(endTaper.tipHalfWidth / halfWidth, 0, 1)
  if (endTaper.taperAtStart && x <= startX + endTaper.taperLength) {
    const progress = clamp((x - startX) / endTaper.taperLength, 0, 1)
    return lerp(tipScale, 1, progress)
  }
  if (endTaper.taperAtEnd && x >= endX - endTaper.taperLength) {
    const progress = clamp((endX - x) / endTaper.taperLength, 0, 1)
    return lerp(tipScale, 1, progress)
  }
  return 1
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
  endTaper: RidgeVentEndTaper | null = null,
): void {
  const totalLen = endX - startX
  const numTabs = Math.max(2, Math.round(totalLen / SHINGLED_TAB_SIZE))
  const tabLen = totalLen / numTabs
  const ridgeH = h * 0.06
  const ridgeD = Math.min(0.01, tabLen * 0.15)

  for (let tab = 1; tab < numTabs; tab++) {
    const x = startX + tab * tabLen
    if (isInsideEndTaper(x, startX, endX, endTaper)) continue
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

function isInsideEndTaper(
  x: number,
  startX: number,
  endX: number,
  endTaper: RidgeVentEndTaper | null,
): boolean {
  if (!endTaper) return false
  return (
    (endTaper.taperAtStart && x <= startX + endTaper.taperLength) ||
    (endTaper.taperAtEnd && x >= endX - endTaper.taperLength)
  )
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

function clipRidgeVentGeometryToSegmentTrim(
  geometry: THREE.BufferGeometry,
  node: RidgeVentNode,
  segment: RoofSegmentNode,
): THREE.BufferGeometry {
  const planes = getSegmentTrimClipPlanes(segment)
  if (planes.length === 0) return geometry

  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  if (!position || !normal || !uv) return geometry

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  for (let i = 0; i < position.count; i += 3) {
    let polygon: RidgeVentGeometryVertex[] = [
      readGeometryVertex(position, normal, uv, i),
      readGeometryVertex(position, normal, uv, i + 1),
      readGeometryVertex(position, normal, uv, i + 2),
    ]

    for (const plane of planes) {
      polygon = clipPolygonToSegmentTrimPlane(polygon, plane, node)
      if (polygon.length < 3) break
    }

    if (polygon.length < 3) continue
    for (let j = 1; j < polygon.length - 1; j += 1) {
      pushGeometryVertex(positions, normals, uvs, polygon[0]!)
      pushGeometryVertex(positions, normals, uvs, polygon[j]!)
      pushGeometryVertex(positions, normals, uvs, polygon[j + 1]!)
    }
  }

  return buildBufferGeometry(positions, normals, uvs)
}

function getSupportLineForVent(
  segment: RoofSegmentNode,
  node: RidgeVentNode,
): RidgeVentSupportLine | null {
  const lines = getRidgeVentLinesForSegment(segment)
  if (lines.length === 0) return null

  const centerX = finiteNumber(node.position?.[0], 0)
  const centerZ = finiteNumber(node.position?.[2], 0)
  const rotationY = finiteNumber(node.rotation, 0)
  const dirX = Math.cos(rotationY)
  const dirZ = -Math.sin(rotationY)

  let best: RidgeVentSupportLine | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const line of lines) {
    const [sx, sz] = line.start
    const [ex, ez] = line.end
    const lineDx = ex - sx
    const lineDz = ez - sz
    const lineLength = Math.hypot(lineDx, lineDz)
    if (!(lineLength > 1e-4)) continue

    const unitX = lineDx / lineLength
    const unitZ = lineDz / lineLength
    const yawPenalty = 1 - Math.abs(unitX * dirX + unitZ * dirZ)
    const centerOffsetX = centerX - sx
    const centerOffsetZ = centerZ - sz
    const t = Math.max(0, Math.min(lineLength, centerOffsetX * unitX + centerOffsetZ * unitZ))
    const nearestX = sx + unitX * t
    const nearestZ = sz + unitZ * t
    const distanceSq = (centerX - nearestX) ** 2 + (centerZ - nearestZ) ** 2
    const score = distanceSq + yawPenalty * 6

    if (score < bestScore) {
      bestScore = score
      const startLocalX = (sx - centerX) * dirX + (sz - centerZ) * dirZ
      const endLocalX = (ex - centerX) * dirX + (ez - centerZ) * dirZ
      const startRadiusSq = sx * sx + sz * sz
      const endRadiusSq = ex * ex + ez * ez
      const outerIsStart = startRadiusSq > endRadiusSq
      const minIsStart = startLocalX <= endLocalX
      best = {
        startX: Math.min(startLocalX, endLocalX),
        endX: Math.max(startLocalX, endLocalX),
        name: line.name,
        taperAtStart: minIsStart ? outerIsStart : !outerIsStart,
        taperAtEnd: minIsStart ? !outerIsStart : outerIsStart,
      }
    }
  }

  return best
}

function readGeometryVertex(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  normal: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
): RidgeVentGeometryVertex {
  return {
    x: position.getX(index),
    y: position.getY(index),
    z: position.getZ(index),
    nx: normal.getX(index),
    ny: normal.getY(index),
    nz: normal.getZ(index),
    u: uv.getX(index),
    v: uv.getY(index),
  }
}

function pushGeometryVertex(
  positions: number[],
  normals: number[],
  uvs: number[],
  vertex: RidgeVentGeometryVertex,
) {
  positions.push(vertex.x, vertex.y, vertex.z)
  normals.push(vertex.nx, vertex.ny, vertex.nz)
  uvs.push(vertex.u, vertex.v)
}

function clipPolygonToSegmentTrimPlane(
  polygon: RidgeVentGeometryVertex[],
  plane: SegmentTrimClipPlane,
  node: RidgeVentNode,
): RidgeVentGeometryVertex[] {
  const next: RidgeVentGeometryVertex[] = []
  let previous = polygon[polygon.length - 1]!
  let previousDistance = getTrimClipDistance(previous, plane, node)
  let previousInside = previousDistance <= 1e-6

  for (const current of polygon) {
    const currentDistance = getTrimClipDistance(current, plane, node)
    const currentInside = currentDistance <= 1e-6

    if (currentInside) {
      if (!previousInside) {
        next.push(interpolateGeometryVertex(previous, current, previousDistance, currentDistance))
      }
      next.push(current)
    } else if (previousInside) {
      next.push(interpolateGeometryVertex(previous, current, previousDistance, currentDistance))
    }

    previous = current
    previousDistance = currentDistance
    previousInside = currentInside
  }

  return next
}

function getTrimClipDistance(
  vertex: RidgeVentGeometryVertex,
  plane: SegmentTrimClipPlane,
  node: RidgeVentNode,
): number {
  const centerX = finiteNumber(node.position?.[0], 0)
  const centerZ = finiteNumber(node.position?.[2], 0)
  const rotationY = finiteNumber(node.rotation, 0)
  const segmentX = centerX + vertex.x * Math.cos(rotationY) + vertex.z * Math.sin(rotationY)
  const segmentZ = centerZ - vertex.x * Math.sin(rotationY) + vertex.z * Math.cos(rotationY)
  return plane.signedDistance(segmentX, segmentZ)
}

function interpolateGeometryVertex(
  a: RidgeVentGeometryVertex,
  b: RidgeVentGeometryVertex,
  distanceA: number,
  distanceB: number,
): RidgeVentGeometryVertex {
  const t = distanceA / (distanceA - distanceB || 1)
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    nx: lerp(a.nx, b.nx, t),
    ny: lerp(a.ny, b.ny, t),
    nz: lerp(a.nz, b.nz, t),
    u: lerp(a.u, b.u, t),
    v: lerp(a.v, b.v, t),
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function getSegmentTrimClipPlanes(segment: RoofSegmentNode): SegmentTrimClipPlane[] {
  const trim = normalizeRoofSegmentTrim(segment)
  const planes: SegmentTrimClipPlane[] = []
  const leftX = -segment.width / 2 + trim.left
  const rightX = segment.width / 2 - trim.right
  const frontZ = segment.depth / 2 - trim.front
  const backZ = -segment.depth / 2 + trim.back

  if (trim.left > 0) planes.push({ signedDistance: (x) => leftX - x })
  if (trim.right > 0) planes.push({ signedDistance: (x) => x - rightX })
  if (trim.front > 0) planes.push({ signedDistance: (_x, z) => z - frontZ })
  if (trim.back > 0) planes.push({ signedDistance: (_x, z) => backZ - z })

  const diagonalPlane = (
    lineA: readonly [number, number],
    lineB: readonly [number, number],
    outsidePoint: readonly [number, number],
  ): SegmentTrimClipPlane | null => {
    const dx = lineB[0] - lineA[0]
    const dz = lineB[1] - lineA[1]
    const length = Math.hypot(dx, dz)
    if (!(length > 0)) return null
    let nx = -dz / length
    let nz = dx / length
    const midX = (lineA[0] + lineB[0]) / 2
    const midZ = (lineA[1] + lineB[1]) / 2
    if (nx * (outsidePoint[0] - midX) + nz * (outsidePoint[1] - midZ) < 0) {
      nx *= -1
      nz *= -1
    }
    return {
      signedDistance: (x, z) => nx * (x - midX) + nz * (z - midZ),
    }
  }

  const pushDiagonalPlane = (
    lineA: readonly [number, number],
    lineB: readonly [number, number],
    outsidePoint: readonly [number, number],
  ) => {
    const plane = diagonalPlane(lineA, lineB, outsidePoint)
    if (plane) planes.push(plane)
  }

  if (trim.frontLeftX > 0 && trim.frontLeftZ > 0) {
    pushDiagonalPlane(
      [leftX + trim.frontLeftX, frontZ],
      [leftX, frontZ - trim.frontLeftZ],
      [leftX - 1, frontZ + 1],
    )
  }
  if (trim.frontRightX > 0 && trim.frontRightZ > 0) {
    pushDiagonalPlane(
      [rightX, frontZ - trim.frontRightZ],
      [rightX - trim.frontRightX, frontZ],
      [rightX + 1, frontZ + 1],
    )
  }
  if (trim.backLeftX > 0 && trim.backLeftZ > 0) {
    pushDiagonalPlane(
      [leftX, backZ + trim.backLeftZ],
      [leftX + trim.backLeftX, backZ],
      [leftX - 1, backZ - 1],
    )
  }
  if (trim.backRightX > 0 && trim.backRightZ > 0) {
    pushDiagonalPlane(
      [rightX - trim.backRightX, backZ],
      [rightX, backZ + trim.backRightZ],
      [rightX + 1, backZ - 1],
    )
  }

  return planes
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
