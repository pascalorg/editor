import {
  type DoorNode,
  getWallCurveFrameAt,
  getWallCurveLength,
  isCurvedWall,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'
import { buildOpeningCutoutShape, ensureRenderableGeometryAttributes } from '@pascal-app/viewer'
import { type BufferGeometry, ExtrudeGeometry, Path, Shape, Vector2 } from 'three'

export function mapCurtainOpeningGeometryToWall(geometry: BufferGeometry, wall: WallNode) {
  if (!isCurvedWall(wall)) return
  const length = getWallCurveLength(wall)
  if (length <= 1e-6) return
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const position = geometry.getAttribute('position')
  for (let index = 0; index < position.count; index++) {
    const along = position.getX(index)
    const depth = position.getZ(index)
    const clampedAlong = Math.max(0, Math.min(length, along))
    const frame = getWallCurveFrameAt(wall, clampedAlong / length)
    const extension = along - clampedAlong
    const x = frame.point.x + frame.tangent.x * extension + frame.normal.x * depth - wall.start[0]
    const z = frame.point.y + frame.tangent.y * extension + frame.normal.y * depth - wall.start[1]
    position.setXYZ(index, x * cos + z * sin, position.getY(index), -x * sin + z * cos)
  }
  position.needsUpdate = true
  geometry.boundingBox = null
  geometry.boundingSphere = null
  geometry.computeVertexNormals()
}

export function curtainOpeningProfile(opening: DoorNode | WindowNode, width: number) {
  const bottom = opening.position[1] - opening.height / 2
  const points = buildOpeningCutoutShape(opening, {
    left: opening.position[0] - opening.width / 2,
    right: opening.position[0] + opening.width / 2,
    bottom,
    top: bottom + opening.height,
  })
    .getPoints(16)
    .filter((point, index, all) => index === 0 || point.distanceToSquared(all[index - 1]!) > 1e-14)
  if (points[0]!.distanceToSquared(points.at(-1)!) < 1e-14) points.pop()
  const outer = points.map((point, index) => {
    const previous = points[(index + points.length - 1) % points.length]!
    const next = points[(index + 1) % points.length]!
    const before = point.clone().sub(previous).normalize()
    const after = next.clone().sub(point).normalize()
    const n1 = new Vector2(before.y, -before.x)
    const n2 = new Vector2(after.y, -after.x)
    const result = point
      .clone()
      .addScaledVector(n1.clone().add(n2), width / Math.max(1e-6, 1 + n1.dot(n2)))
    if (opening.type === 'door' && Math.abs(point.y - bottom) < 1e-7) result.y = bottom
    return result
  })
  return { inner: points, outer }
}

export function buildCurtainOpeningFrame(
  opening: DoorNode | WindowNode,
  width: number,
  depth: number,
) {
  const { inner, outer } = curtainOpeningProfile(opening, width)
  const outline = new Shape(outer)
  outline.closePath()
  let ring: Shape
  if (opening.type === 'door') {
    // The door has jambs and a head; its threshold remains owned by the door.
    ring = new Shape([...outer.slice(1), outer[0]!, inner[0]!, ...inner.slice(1).reverse()])
    ring.closePath()
  } else {
    ring = new Shape(outer)
    ring.closePath()
    const hole = new Path([...inner].reverse())
    hole.closePath()
    ring.holes.push(hole)
  }
  const extrude = (shape: Shape, thickness: number) => {
    const indexed = new ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: false,
      steps: 1,
    })
    indexed.translate(0, 0, -thickness / 2)
    ensureRenderableGeometryAttributes(indexed)
    if (!indexed.index) return indexed
    const geometry = indexed.toNonIndexed()
    indexed.dispose()
    return geometry
  }
  return { frame: extrude(ring, depth), cutter: extrude(outline, depth * 3) }
}

export function curtainProfileSpan(
  points: readonly Vector2[],
  height: number,
): [number, number] | null {
  const xs: number[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!
    if ((a.y <= height && b.y > height) || (b.y <= height && a.y > height))
      xs.push(a.x + ((b.x - a.x) * (height - a.y)) / (b.y - a.y))
  }
  return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null
}
