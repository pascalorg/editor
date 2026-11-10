import type { ColumnNode } from '@pascal-app/core'
import { BufferGeometry, Curve, Float32BufferAttribute, Shape, TubeGeometry, Vector3 } from 'three'
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { getSegments, getShaftScaleAt, getShaftSegmentCount, getShaftTwistRadians } from './shape'

function mergeOwned(parts: BufferGeometry[]) {
  if (!parts.length) return null
  const mixed = parts.some((part) => part.index) && parts.some((part) => !part.index)
  const compatible = mixed ? parts.map((part) => (part.index ? part.toNonIndexed() : part)) : parts
  try {
    return mergeGeometries(compatible)
  } finally {
    for (const part of new Set([...parts, ...compatible])) part.dispose()
  }
}

export function createColumnShaftGeometry(
  node: Pick<
    ColumnNode,
    | 'crossSection'
    | 'radius'
    | 'width'
    | 'depth'
    | 'shaftProfile'
    | 'shaftTaper'
    | 'shaftBulge'
    | 'shaftStartScale'
    | 'shaftEndScale'
    | 'shaftSegmentCount'
    | 'shaftTwistStep'
    | 'shaftCornerRadius'
    | 'edgeSoftness'
    | 'fluteCount'
    | 'fluteWidth'
    | 'fluteDepth'
    | 'shaftDetail'
  >,
  height: number,
  range = { start: 0, end: 1, outset: 0 },
) {
  const count = getShaftSegmentCount(node)
  const rectangular = node.crossSection === 'square' || node.crossSection === 'rectangular'
  const fluteCount =
    node.crossSection === 'round'
      ? Math.max(node.fluteCount, node.shaftDetail === 'fluted' ? 16 : 0)
      : 0
  const radialSegments = fluteCount ? Math.max(32, fluteCount * 6) : getSegments(node)
  const shape = new Shape()
  if (rectangular) {
    const x = node.width / 2,
      z = node.depth / 2
    const r = Math.min(Math.max(0, node.shaftCornerRadius), Math.min(node.width, node.depth) * 0.45)
    shape.moveTo(-x + r, -z)
    shape.lineTo(x - r, -z)
    if (r > 0) shape.absarc(x - r, -z + r, r, -Math.PI / 2, 0, false)
    shape.lineTo(x, z - r)
    if (r > 0) shape.absarc(x - r, z - r, r, 0, Math.PI / 2, false)
    shape.lineTo(-x + r, z)
    if (r > 0) shape.absarc(-x + r, z - r, r, Math.PI / 2, Math.PI, false)
    shape.lineTo(-x, -z + r)
    if (r > 0) shape.absarc(-x + r, -z + r, r, Math.PI, Math.PI * 1.5, false)
    shape.closePath()
  }
  const contour = rectangular
    ? shape
        .getPoints(5)
        .filter((point, i, points) => i === 0 || point.distanceTo(points[i - 1]!) > 1e-8)
    : Array.from({ length: radialSegments }, (_, i) => {
        const angle = (i * Math.PI * 2) / radialSegments
        return { x: Math.sin(angle) * node.radius, y: Math.cos(angle) * node.radius }
      }).reverse()
  const first = contour[0]!,
    last = contour.at(-1)!
  if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-8) contour.pop()
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = []
  const perimeter = [0]
  for (let j = 0; j < contour.length; j++) {
    const a = contour[j]!,
      b = contour[(j + 1) % contour.length]!
    perimeter.push(perimeter[j]! + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const ringSize = contour.length + 1
  const endScale =
    Math.min(getShaftScaleAt(node, range.start), getShaftScaleAt(node, range.end)) + range.outset
  const bevel = Math.min(
    Math.max(0, node.edgeSoftness),
    height * 0.35,
    (rectangular ? Math.min(node.width, node.depth) / 2 : node.radius) * endScale * 0.35,
  )
  const levels = Array.from({ length: count + 1 }, (_, i) => (height * i) / count)
  if (bevel > 0) {
    for (let step = 1; step <= 4; step++) levels.push(bevel * (1 - Math.cos((step * Math.PI) / 8)))
    // Keep top-edge ray hits stable for objects placed on the pillar.
    for (let step = 1; step <= 12; step++)
      levels.push(height - bevel * (1 - Math.cos((step * Math.PI) / 24)))
  }
  const rows = [...new Set(levels)].sort((a, b) => a - b)
  const lastRow = rows.length - 1
  for (let i = 0; i <= lastRow; i++) {
    const t = range.start + ((range.end - range.start) * rows[i]!) / height,
      scale = getShaftScaleAt(node, t) + range.outset
    const yaw = getShaftTwistRadians(node, t * Math.max(0, count - 1))
    for (let j = 0; j <= contour.length; j++) {
      const p = contour[j % contour.length]!
      const groove = fluteCount ? fluteInset(node, Math.atan2(p.y, p.x), scale) : 0
      const radialScale = scale - groove / node.radius
      const distanceToEnd = Math.min(rows[i]!, height - rows[i]!)
      const inset =
        distanceToEnd < bevel
          ? bevel - Math.sqrt(Math.max(0, bevel ** 2 - (bevel - distanceToEnd) ** 2))
          : 0
      const length = Math.hypot(p.x, p.y)
      const softenedScale = Math.max(0.001, radialScale - inset / length)
      positions.push(
        softenedScale * (p.x * Math.cos(yaw) + p.y * Math.sin(yaw)),
        rows[i]!,
        softenedScale * (-p.x * Math.sin(yaw) + p.y * Math.cos(yaw)),
      )
      uvs.push(perimeter[j]! * scale, rows[i]!)
      if (i < lastRow && j < contour.length) {
        const a = i * ringSize + j,
          b = a + ringSize
        indices.push(a, b, a + 1, a + 1, b, b + 1)
      }
    }
  }
  // Separate cap vertices keep the rim sharp and planar UVs in metres.
  for (const row of [0, lastRow]) {
    const start = positions.length / 3
    positions.push(0, row === 0 ? 0 : height, 0)
    uvs.push(0, 0)
    for (let j = 0; j < contour.length; j++) {
      const offset = (row * ringSize + j) * 3
      positions.push(positions[offset]!, positions[offset + 1]!, positions[offset + 2]!)
      uvs.push(positions[offset]!, positions[offset + 2]!)
      const a = start + 1 + j,
        b = start + 1 + ((j + 1) % contour.length)
      indices.push(...(row === 0 ? [start, a, b] : [start, b, a]))
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('uv2', geometry.getAttribute('uv').clone())
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const normals = geometry.getAttribute('normal')
  for (let i = 0; i <= lastRow; i++) {
    const a = i * ringSize,
      b = a + contour.length
    const normal = new Vector3()
      .fromBufferAttribute(normals, a)
      .add(new Vector3().fromBufferAttribute(normals, b))
      .normalize()
    normals.setXYZ(a, normal.x, normal.y, normal.z)
    normals.setXYZ(b, normal.x, normal.y, normal.z)
  }
  if (node.crossSection !== 'round') {
    const creased = toCreasedNormals(geometry, 0.2)
    geometry.dispose()
    return creased
  }
  return geometry
}

type ShaftSurfaceNode = Pick<
  ColumnNode,
  | 'radius'
  | 'width'
  | 'depth'
  | 'crossSection'
  | 'shaftProfile'
  | 'shaftTaper'
  | 'shaftBulge'
  | 'shaftStartScale'
  | 'shaftEndScale'
  | 'shaftSegmentCount'
  | 'shaftTwistStep'
  | 'shaftCornerRadius'
  | 'fluteCount'
  | 'fluteWidth'
  | 'fluteDepth'
  | 'shaftDetail'
>

function fluteInset(
  node: Pick<ColumnNode, 'fluteCount' | 'fluteWidth' | 'fluteDepth' | 'shaftDetail' | 'radius'>,
  angle: number,
  scale: number,
) {
  const count = Math.max(node.fluteCount, node.shaftDetail === 'fluted' ? 16 : 0)
  if (!count) return 0
  const phase = Math.atan2(Math.sin(angle * count), Math.cos(angle * count)) / count
  const halfWidth = Math.min(node.fluteWidth / 2, ((node.radius * scale * Math.PI) / count) * 0.8)
  const distance = Math.abs(phase) * node.radius * scale
  if (distance >= halfWidth) return 0
  return (
    (Math.min(node.fluteDepth, node.radius * scale * 0.35) *
      (1 + Math.cos((Math.PI * distance) / halfWidth))) /
    2
  )
}

/** Interpolate the same sections as the shaft so details stay attached between rings. */
function shaftPoint(node: ShaftSurfaceNode, height: number, angle: number, t: number) {
  const count = getShaftSegmentCount(node),
    row = Math.min(count - 1, Math.floor(t * count))
  const pointAt = (i: number) => {
    const scale = getShaftScaleAt(node, i / count)
    const c = Math.cos(angle),
      s = Math.sin(angle)
    let radius = node.radius
    if (node.crossSection === 'square' || node.crossSection === 'rectangular') {
      const x = node.width / 2,
        z = node.depth / 2
      radius = Math.min(x / Math.max(1e-9, Math.abs(c)), z / Math.max(1e-9, Math.abs(s)))
      const corner = Math.min(node.shaftCornerRadius, Math.min(node.width, node.depth) * 0.45)
      if (Math.abs(radius * c) > x - corner && Math.abs(radius * s) > z - corner) {
        const dot = Math.abs(c) * (x - corner) + Math.abs(s) * (z - corner)
        radius =
          dot +
          Math.sqrt(Math.max(0, dot * dot - (x - corner) ** 2 - (z - corner) ** 2 + corner ** 2))
      }
    } else {
      const segments = getSegments(node)
      const phase =
        (((angle - Math.PI / 2) % ((2 * Math.PI) / segments)) + (2 * Math.PI) / segments) %
        ((2 * Math.PI) / segments)
      if (node.crossSection !== 'round')
        radius *= Math.cos(Math.PI / segments) / Math.cos(phase - Math.PI / segments)
    }
    const distance =
      radius * scale - (node.crossSection === 'round' ? fluteInset(node, angle, scale) : 0)
    const yaw = getShaftTwistRadians(node, (i / count) * Math.max(0, count - 1))
    return new Vector3(
      Math.cos(angle - yaw) * distance,
      (height * i) / count,
      Math.sin(angle - yaw) * distance,
    )
  }
  return pointAt(row).lerp(pointAt(row + 1), t * count - row)
}

class SurfaceCurve extends Curve<Vector3> {
  constructor(private readonly sample: (t: number) => Vector3) {
    super()
  }
  getPoint(t: number, target = new Vector3()) {
    return target.copy(this.sample(t))
  }
}

function surfaceTube(sample: (t: number) => Vector3, steps: number, radius: number) {
  const curve = new SurfaceCurve(sample)
  const geometry = new TubeGeometry(curve, steps, radius, 6, false)
  const uv = geometry.getAttribute('uv'),
    length = curve.getLength()
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, uv.getX(i) * length, uv.getY(i) * Math.PI * 2 * radius)
  geometry.setAttribute('uv2', uv.clone())
  return geometry
}

export function createColumnSpiralGeometry(
  node: ShaftSurfaceNode & Pick<ColumnNode, 'spiralRibCount' | 'spiralTwist'>,
  height: number,
) {
  const count = Math.min(Math.max(node.spiralRibCount, node.shaftDetail === 'spiral' ? 12 : 0), 32)
  if (!count || !node.spiralTwist || height <= 0) return null
  const parts: BufferGeometry[] = []
  for (let i = 0; i < count; i++) {
    parts.push(
      surfaceTube(
        (t) =>
          shaftPoint(
            node,
            height,
            (i / count) * Math.PI * 2 + t * node.spiralTwist * Math.PI * 2,
            0.02 + t * 0.96,
          ),
        Math.max(32, Math.ceil(Math.abs(node.spiralTwist) * 32), getShaftSegmentCount(node) * 2),
        Math.max(0.012, node.radius * 0.06),
      ),
    )
  }
  return mergeOwned(parts)
}

export function createColumnPanelGeometry(node: ColumnNode, height: number) {
  const count = Math.max(
    node.panelCount,
    node.style === 'dravidian-carved' || node.shaftDetail === 'panelled' ? 3 : 0,
  )
  if (!count || height <= 0) return null
  const parts: BufferGeometry[] = []
  const halfHeight = Math.min(0.42, height / Math.max(4, count + 2)) / height / 2
  const rail = Math.max(0.006, node.width * 0.014)
  const halfAngle = 0.33
  for (let row = 0; row < count; row++) {
    const center = (row + 1) / (count + 1)
    for (let face = 0; face < 4; face++) {
      const angle = (face * Math.PI) / 2
      const line = (a: number, b: number, c: number, d: number) => {
        parts.push(
          surfaceTube(
            (t) => {
              const point = shaftPoint(node, height, angle + a + (c - a) * t, b + (d - b) * t)
              const radial = new Vector3(point.x, 0, point.z).normalize()
              return point.addScaledVector(radial, Math.max(0, node.panelInsetDepth) / 2)
            },
            Math.max(16, getShaftSegmentCount(node) * 2),
            rail,
          ),
        )
      }
      line(-halfAngle, center - halfHeight, halfAngle, center - halfHeight)
      line(-halfAngle, center + halfHeight, halfAngle, center + halfHeight)
      line(-halfAngle, center - halfHeight, -halfAngle, center + halfHeight)
      line(halfAngle, center - halfHeight, halfAngle, center + halfHeight)
      if (node.panelShape === 'diamond') {
        line(0, center + halfHeight * 0.8, halfAngle * 0.8, center)
        line(halfAngle * 0.8, center, 0, center - halfHeight * 0.8)
        line(0, center - halfHeight * 0.8, -halfAngle * 0.8, center)
        line(-halfAngle * 0.8, center, 0, center + halfHeight * 0.8)
      } else if (node.panelShape === 'arched') {
        parts.push(
          surfaceTube(
            (t) =>
              shaftPoint(
                node,
                height,
                angle + Math.cos(t * Math.PI) * halfAngle * 0.8,
                center + Math.sin(t * Math.PI) * halfHeight * 0.8,
              ),
            32,
            rail,
          ),
        )
      }
    }
  }
  return mergeOwned(parts)
}

export function createColumnBandGeometry(node: ColumnNode, height: number) {
  const parts: BufferGeometry[] = []
  const band = (t: number, thickness: number, outset: number) => {
    const start = Math.max(0, t - thickness / height / 2)
    const end = Math.min(1, t + thickness / height / 2)
    const geometry = createColumnShaftGeometry(
      { ...node, fluteCount: 0, shaftDetail: 'none' },
      (end - start) * height,
      { start, end, outset },
    )
    geometry.translate(0, start * height, 0)
    parts.push(geometry)
  }
  const ringSpread = Math.min(0.45, Math.max(0.04, node.ringSpread))
  for (let i = 0; i < node.ringCount; i++) {
    const pairCount = Math.ceil(node.ringCount / 2)
    const pairT = pairCount <= 1 ? 0 : Math.floor(i / 2) / (pairCount - 1)
    const offset = Math.min(0.48, 0.06 + pairT * Math.max(0, ringSpread - 0.06))
    const oneSide = Math.min(
      0.48,
      0.06 + (i / Math.max(1, node.ringCount - 1)) * Math.max(0, ringSpread - 0.06),
    )
    const t =
      node.ringPlacement === 'even'
        ? (i + 1) / (node.ringCount + 1)
        : node.ringPlacement === 'top'
          ? 1 - oneSide
          : node.ringPlacement === 'bottom'
            ? oneSide
            : i % 2
              ? 1 - offset
              : offset
    band(t, Math.min(node.ringThickness, height / Math.max(8, node.ringCount * 3)), 0.12)
  }
  const count = Math.max(node.latheRingCount, node.shaftDetail === 'lathe-turned' ? 8 : 0)
  for (let i = 0; i < count; i++) {
    const offset = Math.min(0.48, 0.1 + Math.floor(i / 2) * 0.04)
    const oneSide = Math.min(0.48, 0.08 + i * 0.04)
    const t =
      node.latheRingSpacing === 'even'
        ? (i + 1) / (count + 1)
        : node.latheRingSpacing === 'top'
          ? 1 - oneSide
          : node.latheRingSpacing === 'bottom'
            ? oneSide
            : i % 2
              ? 1 - offset
              : offset
    band(t, Math.min(0.04, height / Math.max(12, count * 3)), 0.1 + (i % 2) * 0.08)
  }
  if (node.lowerBandEnabled && ['shaft', 'all'].includes(node.carvingPlacement)) {
    const size = Math.min(node.lowerBandHeight, height * 0.35)
    band(0.12 + size / height / 2, size, 0.12)
    const ribs = Math.max(6, node.lowerBandCarvingLevel * 6)
    for (let i = 0; i < ribs; i++) {
      parts.push(
        surfaceTube(
          (t) => {
            const point = shaftPoint(
              node,
              height,
              (i / ribs) * Math.PI * 2,
              0.12 + (size / height) * (0.19 + t * 0.62),
            )
            point.x *= 1 + 0.12 / getShaftScaleAt(node, point.y / height)
            point.z *= 1 + 0.12 / getShaftScaleAt(node, point.y / height)
            return point
          },
          24,
          0.012,
        ),
      )
    }
  }
  return mergeOwned(parts)
}
