import { BufferGeometry, Float32BufferAttribute, type LineSegments } from 'three'

/**
 * Axis-aligned box description shared by every placement-cursor wireframe.
 * `dimensions` is the box extent on each axis; `center` is its centre in the
 * cursor group's local space (so an off-centre mesh bbox stays off-centre).
 * `min`/`max` are kept for callers that need the explicit corners.
 */
export type PreviewBounds = {
  min: [number, number, number]
  max: [number, number, number]
  dimensions: [number, number, number]
  center: [number, number, number]
}

export function createLineGeometry(points: number[] = [0, 0, 0, 0, 0, 0]): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3))
  return geometry
}

/** Flatten a box's 12 edges into a `LineSegments` position array. */
export function getBoxEdgePoints(bounds: PreviewBounds): number[] {
  const [width, height, depth] = bounds.dimensions
  const [centerX, centerY, centerZ] = bounds.center
  const minX = centerX - width / 2
  const maxX = centerX + width / 2
  const minY = centerY - height / 2
  const maxY = centerY + height / 2
  const minZ = centerZ - depth / 2
  const maxZ = centerZ + depth / 2

  return [
    minX,
    minY,
    minZ,
    maxX,
    minY,
    minZ,
    maxX,
    minY,
    minZ,
    maxX,
    minY,
    maxZ,
    maxX,
    minY,
    maxZ,
    minX,
    minY,
    maxZ,
    minX,
    minY,
    maxZ,
    minX,
    minY,
    minZ,

    minX,
    maxY,
    minZ,
    maxX,
    maxY,
    minZ,
    maxX,
    maxY,
    minZ,
    maxX,
    maxY,
    maxZ,
    maxX,
    maxY,
    maxZ,
    minX,
    maxY,
    maxZ,
    minX,
    maxY,
    maxZ,
    minX,
    maxY,
    minZ,

    minX,
    minY,
    minZ,
    minX,
    maxY,
    minZ,
    maxX,
    minY,
    minZ,
    maxX,
    maxY,
    minZ,
    maxX,
    minY,
    maxZ,
    maxX,
    maxY,
    maxZ,
    minX,
    minY,
    maxZ,
    minX,
    maxY,
    maxZ,
  ]
}

export function updateLineGeometry(ref: React.RefObject<LineSegments>, points: number[]) {
  const geometry = ref.current?.geometry
  if (!geometry) return

  const attribute = geometry.getAttribute('position') as Float32BufferAttribute | undefined
  if (!attribute || attribute.array.length !== points.length) {
    geometry.setAttribute('position', new Float32BufferAttribute(points, 3))
  } else {
    attribute.set(points)
    attribute.needsUpdate = true
  }
  geometry.computeBoundingSphere()
}
