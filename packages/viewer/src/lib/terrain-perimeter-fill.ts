import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three'
import { ensureRenderableGeometryAttributes } from './csg-utils'

export type TerrainPerimeterPoint = { x: number; z: number }

export function buildTerrainPerimeterFillGeometry(
  points: readonly TerrainPerimeterPoint[],
  bottomY: readonly number[],
  topY: number,
  epsilon = 1e-6,
): BufferGeometry | null {
  if (points.length < 3 || bottomY.length !== points.length) return null
  if (bottomY.every((y) => y >= topY - epsilon)) return null

  let signedArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!
    const b = points[(index + 1) % points.length]!
    signedArea += a.x * b.z - b.x * a.z
  }
  const counterClockwise = signedArea > 0
  const positions: number[] = []
  const push = (point: TerrainPerimeterPoint, y: number) => {
    positions.push(point.x, y, point.z)
  }

  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length
    const a = points[index]!
    const b = points[next]!
    const ay = bottomY[index]!
    const by = bottomY[next]!
    if (ay >= topY - epsilon && by >= topY - epsilon) continue

    if (counterClockwise) {
      push(a, topY)
      push(b, by)
      push(a, ay)
      push(a, topY)
      push(b, topY)
      push(b, by)
    } else {
      push(a, topY)
      push(a, ay)
      push(b, by)
      push(a, topY)
      push(b, by)
      push(b, topY)
    }
  }

  const faces = ShapeUtils.triangulateShape(
    points.map((point) => new Vector2(point.x, point.z)),
    [],
  )
  for (const face of faces) {
    const [ia, ib, ic] = face
    if (ia == null || ib == null || ic == null) continue
    if (
      bottomY[ia]! >= topY - epsilon &&
      bottomY[ib]! >= topY - epsilon &&
      bottomY[ic]! >= topY - epsilon
    ) {
      continue
    }
    const a = points[ia]!
    const b = points[ib]!
    const c = points[ic]!
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
    push(a, bottomY[ia]!)
    if (cross >= 0) {
      push(b, bottomY[ib]!)
      push(c, bottomY[ic]!)
    } else {
      push(c, bottomY[ic]!)
      push(b, bottomY[ib]!)
    }
  }

  if (positions.length === 0) return null
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  ensureRenderableGeometryAttributes(geometry)
  return geometry
}
