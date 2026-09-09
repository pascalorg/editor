import { Euler, Vector3 } from 'three'
import type { Point2 } from './marquee-geometry'

export function marqueePolygon(node: {
  polygon?: unknown
  position?: unknown
  rotation?: unknown
}): Point2[] | null {
  const { polygon, position, rotation } = node
  if (
    !Array.isArray(polygon) ||
    polygon.length === 0 ||
    !polygon.every(
      (point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite),
    )
  )
    return null
  // Position-based kinds author their footprint locally, unlike slabs and zones.
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite))
    return polygon as Point2[]
  const angles =
    Array.isArray(rotation) && rotation.length === 3 && rotation.every(Number.isFinite)
      ? new Euler(rotation[0], rotation[1], rotation[2])
      : new Euler()
  return polygon.map(([x, z]) => {
    const point = new Vector3(x, 0, z).applyEuler(angles)
    return [point.x + position[0], point.z + position[2]]
  })
}
