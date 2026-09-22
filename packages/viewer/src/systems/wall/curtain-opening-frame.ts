import type { DoorNode, WindowNode } from '@pascal-app/core'
import { ExtrudeGeometry, Path, Shape, Vector2 } from 'three'
import { ensureRenderableGeometryAttributes } from '../../lib/csg-utils'
import { buildOpeningCutoutShape } from './opening-cutout-geometry'

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
    const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 })
    geometry.translate(0, 0, -thickness / 2)
    ensureRenderableGeometryAttributes(geometry)
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
